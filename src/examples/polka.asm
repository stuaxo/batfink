; Polka -- a flat grid of dots on animated cloth.
; Mode 0. Eighteen filled circles are drawn ONCE at start-up in a rigid
; staggered grid, each in one of inks 1-8 (a tight warm ramp). The grid
; never moves. Everything else is palette:
;   * the interrupt runs a raster down every band, rewriting ink 0 every
;     few scanlines from a sine gradient -- a smooth vertical wash, not
;     flat blocks -- and it scrolls, so light seems to play over folds;
;   * the dot ramp rotates one step at a time, so warm colour drifts
;     diagonally across the grid;
;   * CRTC R13 sways the whole field a couple of pixels, during blanking.
; The dot pixels are never ink 0, so the wash flows behind them and the
; grid reads as a print on moving fabric.

GA     equ &7F00
PPI_B  equ &F500
SCREEN equ &C000
RAD    equ 20              ; dot vertical radius, scanlines
STEPS  equ 7               ; raster changes per band
DELAY  equ 105             ; inner delay between them, ~one band / STEPS

       org &4000

start: di
       ld sp,&BFF0
       im 1
       ld a,&C3
       ld (&0038),a
       ld hl,irq
       ld (&0039),hl

       ld bc,GA
       ld a,&8C                  ; mode 0, both ROMs paged out
       out (c),a

       call cls
       call setwarm             ; pens 1-8 = the warm ramp
       call drawdots
       ei

; ---------------------------------------------------------------------
; Main loop. The rasters live in the interrupt; here we just nudge the
; three slow phases, each on its own divider.
; ---------------------------------------------------------------------
main:  call waitvsync
       ld a,5                  ; re-phase: next interrupt is band 0, at the top
       ld (barpos),a

; --- sway: CRTC R13, during blanking. Step every 8 frames.
       ld hl,swtick
       inc (hl)
       ld a,(hl)
       cp 8
       jr c,sw0
       ld (hl),0
       ld hl,swphase
       inc (hl)
       ld a,(hl)
       and 15
       ld (hl),a
sw0:   ld hl,sinetab
       ld a,(swphase)
       ld e,a
       ld d,0
       add hl,de
       ld a,(hl)
       ld bc,&BC0D
       out (c),c
       ld b,&BD
       out (c),a

; --- dot ramp: rotate one step every 12 frames.
       ld hl,cctick
       inc (hl)
       ld a,(hl)
       cp 12
       jr c,gr
       ld (hl),0
       ld hl,phase
       inc (hl)
       ld a,(hl)
       cp 8
       jr c,cc0
       xor a
       ld (hl),a
cc0:   call setwarm

; --- gradient scroll: one step every 5 frames.
gr:    ld hl,grtick
       inc (hl)
       ld a,(hl)
       cp 5
       jr c,main
       ld (hl),0
       ld hl,grphase
       inc (hl)
       ld a,(hl)
       cp 24
       jr c,main
       ld (hl),0
       jr main

; ---------------------------------------------------------------------
; Interrupt: a raster down one band. STEPS colour changes, DELAY apart,
; taken from grad[] at (barbase[band] + step + grphase).
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
       ld l,a
       ld h,0
       ld de,barbase
       add hl,de
       ld a,(hl)
       ld hl,grphase
       add a,(hl)
       ld (gidx),a
       ld a,STEPS
       ld (stepc),a
irqs:  ld a,(gidx)
irqn:  cp 24
       jr c,irqm
       sub 24
       jr irqn
irqm:  ld l,a
       ld h,0
       ld de,grad
       add hl,de
       ld a,(hl)
       ld bc,GA
       ld e,a
       out (c),c                 ; ink 0
       out (c),a
       ld a,&10                  ; border
       out (c),a
       ld a,e
       out (c),a
       ld hl,gidx
       inc (hl)
       ld a,DELAY
irqd:  dec a
       jr nz,irqd
       ld hl,stepc
       dec (hl)
       jr nz,irqs
       pop hl
       pop de
       pop bc
       pop af
       ei
       ret

; ---------------------------------------------------------------------
; Pens 1-8 from warm[], rotated by phase.
; ---------------------------------------------------------------------
setwarm:
       ld a,1
       ld (cpn),a
sw1:   ld a,(phase)
       ld hl,cpn
       add a,(hl)
       dec a
sw2:   cp 8
       jr c,sw3
       sub 8
       jr sw2
sw3:   ld e,a
       ld d,0
       ld hl,warm
       add hl,de
       ld a,(hl)
       ld (cpcol),a
       ld bc,GA
       ld a,(cpn)
       out (c),a
       ld a,(cpcol)
       out (c),a
       ld hl,cpn
       inc (hl)
       ld a,(hl)
       cp 9
       jr c,sw1
       ret

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

cls:   ld hl,SCREEN
       ld de,SCREEN+1
       ld bc,&3FFF
       ld (hl),0
       ldir
       ret

; ---------------------------------------------------------------------
; Dots. Each record: centre x (pixels), centre y (line), pen.
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

; A = pen; dcx/dcy set. Fills a circle: walk rows out from the centre,
; half-width from hwtab.
dot:   ld l,a
       ld h,0
       ld de,solidtab
       add hl,de
       ld a,(hl)
       ld (fillbyte),a

       ld a,(dcy)
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

       ld a,(dcy)
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

dotrow:
       ld a,(dline)
       cp 200
       ret nc
       ld (cury),a
       ld a,(dady)
       ld l,a
       ld h,0
       ld de,hwtab
       add hl,de
       ld a,(hl)
       or a
       ret z
       ld c,a
       ld a,(dcx)
       sub c
       jr nc,dr0
       xor a
dr0:   srl a
       ld (curx),a
       ld d,a
       ld a,(dcx)
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

; curx (bytes), cury (line) -> HL. Layout is mode-independent: eight
; blocks of &800, one per line within a char row.
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
       add hl,hl
       ld d,h
       ld e,l
       add hl,hl
       add hl,hl
       add hl,de
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
solidtab: db &00,&C0,&0C,&CC,&30,&F0,&3C,&FC,&03,&C3,&0F,&CF,&33,&F3,&3F,&FF

hwtab:    db 10,10,10,10,10,10,10,9,9,9,9,8,8,8,7,7,6,5,4,3,0

sinetab:  db 0,0,0,1,1,2,2,2,2,2,1,1,1,0,0,0

; Warm ramp, &40+n: white, pastel yellow, bright yellow, orange,
; bright red, bright magenta, pink, pastel magenta -- loops smoothly.
warm:     db &5B,&43,&5A,&4E,&4C,&4D,&47,&4F

; The backdrop wash, &40+n: a calm triangle through black - blue -
; bright blue - sky - pastel blue and back, each shade held for three
; samples so it reads as a gradient, not stripes. 24 entries, loops.
grad:     db &54,&54,&54,&44,&44,&44,&55,&55,&55,&57,&57,&57
          db &5F,&5F,&5F,&57,&57,&57,&55,&55,&55,&44,&44,&44

; Start index into grad[] for each of the six bands (band * STEPS mod 24).
barbase:  db 0,7,14,21,4,11

; Staggered grid, pens spread on a diagonal so the ramp rotation reads
; as a wave. Each record: centre x, centre y, pen.
dots:     db  20, 26, 1,   50, 26, 4,   80, 26, 7,  110, 26, 2,  140, 26, 5
          db  35, 76, 4,   65, 76, 6,   95, 76, 8,  125, 76, 2
          db  20,126, 7,   50,126, 1,   80,126, 3,  110,126, 5,  140,126, 7
          db  35,176, 2,   65,176, 4,   95,176, 6,  125,176, 8

phase:    db 0
cctick:   db 0
grphase:  db 0
grtick:   db 0
gidx:     db 0
stepc:    db 0
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
