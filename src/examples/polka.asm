; Polka -- big dots animated entirely by the palette.
; Mode 0, 160x200, 16 inks. Eighteen filled circles are drawn ONCE at
; start-up, each in one of inks 1-15. Nothing in the main loop touches
; screen memory:
;   * inks 1-15 are rotated one step per frame, so colour flows
;     diagonally across the dots -- a classic colour-cycle;
;   * the interrupt rewrites ink 0 six times down the screen, so drifting
;     horizontal bands show through the gaps and appear to bend around
;     the dots (the dot pixels aren't ink 0, so the band never covers them);
;   * CRTC register 13 is nudged from a sine table, swaying the field.

GA     equ &7F00           ; Gate Array
PPI_B  equ &F500           ; bit 0 = CRTC VSYNC
SCREEN equ &C000
RAD      equ 20              ; dot vertical radius, in scanlines

       org &4000

start: di
       ld sp,&BFF0
       im 1
       ld a,&C3                  ; JP irq at the mode-1 vector
       ld (&0038),a
       ld hl,irq
       ld (&0039),hl

       ld bc,GA
       ld a,&8C                  ; mode 0, both ROMs paged out
       out (c),a

       call cls
       call initpens
       call drawdots
       ei

; ---------------------------------------------------------------------
; Main loop: 50Hz, palette only.
; ---------------------------------------------------------------------
main:  call waitvsync
       ld a,4
       ld (barpos),a             ; re-phase the interrupt counter

; The sway goes first, during blanking: CRTC R13 shifts the fetch start,
; so the whole field slides. A mid-frame change here would tear.
       ld hl,sinetab
       ld a,(swphase)
       ld e,a
       ld d,0
       add hl,de
       ld a,(hl)
       ld bc,&BC0D               ; CRTC R13 = display start, low byte
       out (c),c
       ld b,&BD
       out (c),a

       ld a,(phase)              ; step the dot palette
       inc a
       cp 15
       jr c,ph0
       xor a
ph0:   ld (phase),a
       call cyclepens

       ld a,(bgtick)             ; every 4th frame, drift the bands down
       inc a
       ld (bgtick),a
       and 3
       jr nz,sw
       ld a,(bgphase)
       inc a
       and 7
       ld (bgphase),a

sw:    ld a,(swtick)             ; every other frame, step the sway
       inc a
       ld (swtick),a
       and 1
       jr nz,main
       ld a,(swphase)
       inc a
       and 15
       ld (swphase),a
       jr main

; ---------------------------------------------------------------------
; Interrupt: six bands a frame, pen 0 taken from bgtab and scrolled by
; bgphase so the bands crawl downward past the still dots.
; ---------------------------------------------------------------------
irq:   push af
       push bc
       push de
       push hl
       ld a,(barpos)
       inc a
       cp 6
       jr c,irq0
       xor a
irq0:  ld (barpos),a
       ld hl,bgphase
       add a,(hl)
       and 7
       ld e,a
       ld d,0
       ld hl,bgtab
       add hl,de
       ld a,(hl)
       ld bc,GA
       ld e,a
       out (c),c                 ; select pen 0
       out (c),a
       ld a,&10                  ; ...and the border
       out (c),a
       ld a,e
       out (c),a
       pop hl
       pop de
       pop bc
       pop af
       ei
       ret

; ---------------------------------------------------------------------
; Palette. cyclepens sets pens 1-15 from coltab, offset by phase.
; ---------------------------------------------------------------------
initpens:
       ld bc,GA
       xor a
       out (c),a                 ; pen 0
       ld a,(bgtab)
       out (c),a
       ld a,&10                  ; border
       out (c),a
       ld a,(bgtab)
       out (c),a
       ; fall through

cyclepens:
       ld a,1
       ld (cpn),a
cp0:   ld a,(phase)
       ld hl,cpn
       add a,(hl)
       dec a                     ; index = phase + pen - 1
cpm:   cp 15
       jr c,cpi
       sub 15
       jr cpm
cpi:   ld e,a
       ld d,0
       ld hl,coltab
       add hl,de
       ld a,(hl)
       ld (cpcol),a
       ld bc,GA
       ld a,(cpn)
       out (c),a                 ; select pen n
       ld a,(cpcol)
       out (c),a                 ; ...give it coltab[index]
       ld hl,cpn
       inc (hl)
       ld a,(hl)
       cp 16
       jr c,cp0
       ret

; ---------------------------------------------------------------------
; Wait for the start of vertical sync.
; ---------------------------------------------------------------------
waitvsync:
       ld bc,PPI_B
wv1:   in a,(c)
       rra
       jr c,wv1
wv2:   in a,(c)
       rra
       jr nc,wv2
       ret

; ---------------------------------------------------------------------
cls:   ld hl,SCREEN
       ld de,SCREEN+1
       ld bc,&3FFF
       ld (hl),0
       ldir
       ret

; ---------------------------------------------------------------------
; Dots. Each record is centre x (pixels), centre y (line), pen.
; ---------------------------------------------------------------------
drawdots:
       ld ix,dots
       ld b,18
dd1:   push bc
       ld a,(ix+0)
       ld (dcx),a
       ld a,(ix+1)
       ld (dcy),a
       ld a,(ix+2)
       call dot
       ld bc,3
       add ix,bc
       pop bc
       djnz dd1
       ret

; A = pen; dcx/dcy already set. Fills a circle of radius RAD by walking
; the rows out from the centre, half-width from hwtab.
dot:   ld l,a
       ld h,0
       ld de,solidtab
       add hl,de
       ld a,(hl)
       ld (fillbyte),a

       ld a,(dcy)                ; top half, centre row included
       sub RAD
       ld (dline),a
       ld a,RAD
       ld (dady),a
       ld b,RAD+1
dt1:   push bc
       call dotrow
       ld hl,dline
       inc (hl)
       ld hl,dady
       dec (hl)
       pop bc
       djnz dt1

       ld a,(dcy)               ; bottom half
       inc a
       ld (dline),a
       ld a,1
       ld (dady),a
       ld b,RAD
dt2:   push bc
       call dotrow
       ld hl,dline
       inc (hl)
       ld hl,dady
       inc (hl)
       pop bc
       djnz dt2
       ret

; Fill one scanline of the current dot. dline = line, dady = |dy|.
dotrow:
       ld a,(dline)
       cp 200                    ; also skips the -1/-2 rows (wrapped to 254/255)
       ret nc
       ld (cury),a
       ld a,(dady)
       ld l,a
       ld h,0
       ld de,hwtab
       add hl,de
       ld a,(hl)                 ; half-width in pixels
       or a
       ret z
       ld c,a
       ld a,(dcx)               ; left edge -> start byte
       sub c
       jr nc,dr0
       xor a
dr0:   srl a
       ld (curx),a
       ld d,a
       ld a,(dcx)               ; right edge -> end byte
       add a,c
       srl a
       cp 80
       jr c,dr1
       ld a,79
dr1:   sub d
       inc a
       ld (drcnt),a
       call scraddr
       ld a,(fillbyte)
       ld c,a
       ld a,(drcnt)
       ld b,a
dr2:   ld (hl),c
       inc hl
       djnz dr2
       ret

; curx (bytes), cury (line) -> HL screen address. The layout is the same
; in every mode: eight blocks of &800, one per line within a char row.
scraddr:
       ld a,(cury)
       ld b,a
       and 7
       add a,a
       add a,a
       add a,a
       add a,&C0
       ld h,a
       ld l,0
       push hl
       ld a,b
       rrca
       rrca
       rrca
       and &1F
       ld l,a
       ld h,0
       add hl,hl
       add hl,hl
       add hl,hl
       add hl,hl                 ; row * 16
       ld d,h
       ld e,l
       add hl,hl
       add hl,hl                 ; row * 64
       add hl,de                 ; row * 80
       ld a,(curx)
       ld e,a
       ld d,0
       add hl,de
       pop de
       add hl,de
       ret

; ---------------------------------------------------------------------
; Data
; ---------------------------------------------------------------------
; Solid mode-0 byte (both pixels one pen) for pens 0-15.
solidtab: db &00,&C0,&0C,&CC,&30,&F0,&3C,&FC,&03,&C3,&0F,&CF,&33,&F3,&3F,&FF

; Ellipse half-width for |dy| = 0..RAD. Twice as tall as wide in mode-0
; units, which comes out round once the display stretches it.
hwtab:    db 10,10,10,10,10,10,10,9,9,9,9,8,8,8,7,7,6,5,4,3,0

; Ease-in-out sway, 0..2 bytes, added to CRTC R13.
sinetab:  db 0,0,0,1,1,2,2,2,2,2,1,1,1,0,0,0

; Fifteen hardware colours, &40+n, a rainbow that loops.
coltab:   db &4C,&4E,&5E,&5A,&50,&52,&42,&53,&57,&55,&44,&5D,&58,&4D,&47

; Pen 0 down the screen: blue -> purple -> sky and back, scrolled by bgphase.
bgtab:    db &54,&44,&45,&55,&57,&55,&45,&44

; Staggered grid. Each record: centre x (pixels), centre y (line), pen.
dots:     db  20, 26, 1,   50, 26, 3,   80, 26, 5,  110, 26, 7,  140, 26, 9
          db  35, 76, 4,   65, 76, 6,   95, 76, 8,  125, 76,10
          db  20,126, 7,   50,126, 9,   80,126,11,  110,126,13,  140,126,15
          db  35,176,10,   65,176,12,   95,176,14,  125,176, 1

phase:    db 0
bgphase:  db 0
bgtick:   db 0
swphase:  db 0
swtick:   db 0
barpos:   db 0
cpn:      db 0
cpcol:    db 0
dcx:      db 0
dcy:      db 0
dline:    db 0
dady:     db 0
drcnt:    db 0
fillbyte: db 0
curx:     db 0
cury:     db 0
