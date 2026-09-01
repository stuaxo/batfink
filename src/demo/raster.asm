; =====================================================================
;  R A S T E R   S T A T E   O F   M I N D
;  A demo for the Amstrad CPC 464 -- Z80, mode 1, 320x200, four inks.
;
;  No firmware calls: this talks straight to the Gate Array and the PPI,
;  so it runs on a bare machine with the ROMs paged out.
; =====================================================================

DELAY     equ 38              ; inner delay, tuned to about three scanlines
NBANDS    equ 12              ; colour changes per raster block
GATEARRAY equ &7F00           ; Gate Array: ink select, ink colour, mode
PPI_B     equ &F500           ; PPI port B: bit 0 is the CRTC VSYNC flag
SCREEN    equ &C000

NBALLS    equ 3
BTOP      equ 52              ; sprite field, top scanline
BHEIGHT   equ 69              ; ...and how many scanlines it spans
BRIGHT    equ 77              ; rightmost sprite column, in bytes
SCRY      equ 164             ; top scanline of the scroller strip
SCRX      equ 14              ; scroller window, left edge in bytes
SCRW      equ 52              ; ...and its width in bytes (208 pixels)
SCRLOOP   equ 17              ; (SCRW - 1) / 3: the shift loop does three at a time

          org &4000

; ---------------------------------------------------------------------
; Set up, then loop forever at 50Hz.
; ---------------------------------------------------------------------
start:    di
          ld sp,&BFF0
          im 1
          ld a,&C3                  ; JP irq at the mode-1 vector
          ld (&0038),a
          ld hl,irq
          ld (&0039),hl

          ld bc,GATEARRAY
          ld a,&8D                  ; both ROMs off, screen mode 1
          out (c),a

          call cls
          call setpens
          call drawheader
          ei

frame:    call waitvsync
          ld a,4                    ; re-phase the raster counter
          ld (barpos),a
          call eraseballs
          call moveballs
          call drawballs
          call scroller
          call animate
          jr frame

; ---------------------------------------------------------------------
; Interrupt handler. The CPC interrupts every 52 scanlines, six times a
; frame, so changing ink 0 here paints horizontal bands down the screen.
; ---------------------------------------------------------------------
irq:      push af
          push bc
          push de
          push hl
          ld a,(barpos)
          inc a
          cp 6
          jr c,irq1
          xor a
irq1:     ld (barpos),a
          cp 2
          jr z,rasters              ; band 2 gets the raster treatment
          ld c,a                    ; the rest take one flat colour each
          ld b,0
          ld hl,flattab
          add hl,bc
          ld a,(hl)
          call setink0
          jr irqend

; Twelve colour changes, four scanlines apart, painted down the header
; panel before the next interrupt is due. This is the whole trick: the
; CRTC is still drawing while the Z80 rewrites ink 0 underneath it.
rasters:  ld a,(barbase)
          ld l,a
          ld h,0
          ld de,bartab
          add hl,de
          ld d,NBANDS
irq2:     ld a,(hl)
          call setink0
          inc hl
          ld a,DELAY
irq3:     dec a
          jr nz,irq3
          dec d
          jr nz,irq2
          ld a,&54                  ; back to black below the block
          call setink0
irqend:   pop hl
          pop de
          pop bc
          pop af
          ei
          ret

setink0:  ld bc,GATEARRAY           ; A = hardware colour for ink 0 + border
          ld e,a
          out (c),c
          out (c),a
          ld a,&10
          out (c),a
          ld a,e
          out (c),a
          ret

; ---------------------------------------------------------------------
; Wait for the start of the vertical sync pulse.
; ---------------------------------------------------------------------
waitvsync:
          ld bc,PPI_B
wv1:      in a,(c)
          rra
          jr c,wv1                  ; still in sync from last frame
wv2:      in a,(c)
          rra
          jr nc,wv2
          ret

; ---------------------------------------------------------------------
; Screen and palette.
; ---------------------------------------------------------------------
cls:      ld hl,SCREEN
          ld de,SCREEN+1
          ld bc,&3FFF
          ld (hl),0
          ldir
          ret

setpens:  ld hl,pentab
          ld bc,GATEARRAY
          ld e,0
sp1:      out (c),e
          ld a,(hl)
          out (c),a
          inc hl
          inc e
          ld a,e
          cp 4
          jr c,sp1
          ld a,&10
          out (c),a
          ld a,(hl)
          out (c),a
          ret

; HL = screen address of (curx, cury).  curx is in bytes, cury in lines.
; CPC screen memory is interleaved: eight blocks of &800, one per raster
; line within a character row.
scraddr:  ld a,(cury)
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
; Text. Two sizes: 8x8 straight from the font, and the same glyphs with
; every pixel doubled for the header.
; ---------------------------------------------------------------------
; A = font byte -> two mode-1 bytes in buf4.
expand2:  ld c,a
          and &F0
          ld b,a
          ld a,c
          rrca
          rrca
          rrca
          rrca
          and &0F
          or b
          ld (buf4),a
          ld a,c
          add a,a
          add a,a
          add a,a
          add a,a
          ld b,a
          ld a,c
          and &0F
          or b
          ld (buf4+1),a
          ret

; A = font byte -> four mode-1 bytes in buf4, pixels doubled.
expand4:  ld (tmpbyte),a
          rrca
          rrca
          rrca
          rrca
          and 15
          add a,a
          ld l,a
          ld h,0
          ld bc,dbltab
          add hl,bc
          ld a,(hl)
          ld (buf4),a
          inc hl
          ld a,(hl)
          ld (buf4+1),a
          ld a,(tmpbyte)
          and 15
          add a,a
          ld l,a
          ld h,0
          ld bc,dbltab
          add hl,bc
          ld a,(hl)
          ld (buf4+2),a
          inc hl
          ld a,(hl)
          ld (buf4+3),a
          ret

putrow4:  ld a,4                    ; copy buf4 to the screen at curx,cury
          jr putrow0
putrow2:  ld a,2
putrow0:  ld (rowlen),a
          call scraddr
          ld de,buf4
          ld a,(rowlen)
          ld b,a
pr1:      ld a,(de)
          ld c,a
          ld a,(hl)
          or c
          ld (hl),a
          inc hl
          inc de
          djnz pr1
          ret

nextline: ld hl,cury
          inc (hl)
          ret

; HL = HL moved down one scanline. Within a character row that is just
; +&800; on the eighth line it wraps back and steps on by one row of 80
; bytes instead. Far cheaper than recomputing the address from scratch.
nextscan: ld a,h
          add a,8
          ld h,a
          and &38
          ret nz
          ld a,l
          add a,80
          ld l,a
          ld a,h
          adc a,&C0
          ld h,a
          ret

; HL = glyph pointer for the character in A.
glyphof:  sub 32
          ld l,a
          ld h,0
          add hl,hl
          add hl,hl
          add hl,hl
          ld bc,font
          add hl,bc
          ret

bigchar:  call glyphof
          ld (glyphptr),hl
          ld b,8
bch1:     push bc
          ld hl,(glyphptr)
          ld a,(hl)
          inc hl
          ld (glyphptr),hl
          call expand4
          call putrow4
          call nextline
          call putrow4
          call nextline
          pop bc
          djnz bch1
          ret

smallchar:
          call glyphof
          ld (glyphptr),hl
          ld b,8
sch1:     push bc
          ld hl,(glyphptr)
          ld a,(hl)
          inc hl
          ld (glyphptr),hl
          call expand2
          call putrow2
          call nextline
          pop bc
          djnz sch1
          ret

; HL = zero-terminated string; curx/cury = top-left. A width of 4 bytes
; per character for the large font, 2 for the small one.
bigtext:  ld a,1
          jr text0
smalltext:
          xor a
text0:    ld (bigflag),a
          ld (strptr),hl
          ld a,(cury)
          ld (savey),a
txt1:     ld hl,(strptr)
          ld a,(hl)
          or a
          ret z
          inc hl
          ld (strptr),hl
          ld c,a
          ld a,(bigflag)
          or a
          ld a,c
          jr z,txt2
          call bigchar
          jr txt3
txt2:     call smallchar
txt3:     ld a,(savey)
          ld (cury),a
          ld a,(bigflag)
          or a
          ld a,2
          jr z,txt4
          ld a,4
txt4:     ld b,a
          ld a,(curx)
          add a,b
          ld (curx),a
          jr txt1

hline:    ld (tmpbyte),a            ; A = pattern, curx/cury = start, hlcount = length
          call scraddr
          ld a,(hlcount)
          ld b,a
          ld a,(tmpbyte)
hl1:      ld (hl),a
          inc hl
          djnz hl1
          ret

fullrule: ld a,0                    ; a rule across the whole screen
          ld (curx),a
          ld a,80
          ld (hlcount),a
          ret

panelrule:
          ld a,SCRX                 ; ...and one the width of the message window
          ld (curx),a
          ld a,SCRW
          ld (hlcount),a
          ret

drawheader:
          ld a,18
          ld (curx),a
          ld a,8
          ld (cury),a
          ld hl,title
          call bigtext

          ld a,7
          ld (curx),a
          ld a,32
          ld (cury),a
          ld hl,subtitle
          call smalltext

          call fullrule
          ld a,46
          ld (cury),a
          ld a,&F0
          call hline
          call fullrule
          ld a,47
          ld (cury),a
          ld a,&50
          call hline

          call panelrule
          ld a,146
          ld (cury),a
          ld a,&F0
          call hline
          call panelrule
          ld a,147
          ld (cury),a
          ld a,&50
          call hline
          call panelrule
          ld a,188
          ld (cury),a
          ld a,&50
          call hline
          call panelrule
          ld a,189
          ld (cury),a
          ld a,&F0
          call hline
          ret

; ---------------------------------------------------------------------
; Sprites. Each record is x, y, dx, dy, plane mask. The mask picks which
; of the two mode-1 bit planes the ball is drawn into, so the same
; artwork appears in ink 1, 2 or 3.
; ---------------------------------------------------------------------
eraseballs:
          ld ix,balls
          ld b,NBALLS
eb0:      push bc
          call eraseball
          ld bc,5
          add ix,bc
          pop bc
          djnz eb0
          ret

drawballs:
          ld ix,balls
          ld b,NBALLS
db0:      push bc
          call drawball
          ld bc,5
          add ix,bc
          pop bc
          djnz db0
          ret

moveballs:
          ld ix,balls
          ld b,NBALLS
mb0:      push bc
          ld a,(ix+0)
          add a,(ix+2)
          cp BRIGHT
          jr c,mbx
          ld a,(ix+2)
          neg
          ld (ix+2),a
          ld a,(ix+0)
          add a,(ix+2)
mbx:      ld (ix+0),a
          ld a,(ix+1)
          add a,(ix+3)
          ld c,a
          sub BTOP
          cp BHEIGHT
          jr c,mby
          ld a,(ix+3)
          neg
          ld (ix+3),a
          ld a,(ix+1)
          add a,(ix+3)
          ld c,a
mby:      ld (ix+1),c
          ld bc,5
          add ix,bc
          pop bc
          djnz mb0
          ret

setpos:   ld a,(ix+0)
          ld (curx),a
          ld a,(ix+1)
          ld (cury),a
          ret

drawball: call setpos
          call scraddr
          ld de,balldata
          ld c,(ix+4)               ; plane mask picks the ink
          ld b,16
dba1:     push hl
          ld a,(de)
          and c
          or (hl)
          ld (hl),a
          inc de
          inc hl
          ld a,(de)
          and c
          or (hl)
          ld (hl),a
          inc de
          inc hl
          ld a,(de)
          and c
          or (hl)
          ld (hl),a
          inc de
          inc hl
          ld a,(de)
          and c
          or (hl)
          ld (hl),a
          inc de
          pop hl
          call nextscan
          djnz dba1
          ret

eraseball:
          call setpos
          call scraddr
          ld b,16
eba1:     push hl
          xor a
          ld (hl),a
          inc hl
          ld (hl),a
          inc hl
          ld (hl),a
          inc hl
          ld (hl),a
          pop hl
          call nextscan
          djnz eba1
          ret

; ---------------------------------------------------------------------
; Scroller. Eight scanlines are shifted two pixels left every frame.
; In mode 1 the two bit planes are interleaved inside each byte, so a
; two-pixel shift is (b AND &33) << 2, with the incoming pixels taken
; from bits 7,6,3,2 of the byte to its right.
; ---------------------------------------------------------------------
scroller: ld a,(scrcnt)
          dec a
          ld (scrcnt),a
          jr nz,scr0
          call loadcol
scr0:     ld a,SCRY
          ld (cury),a
          ld a,SCRX
          ld (curx),a
          call scraddr
          ld iy,offcol
          ld a,7                    ; the eighth font row is always blank
          ld (rowcnt),a
scr1:     push hl
          ld d,h
          ld e,l
          inc de                    ; DE reads one byte ahead of HL
          ld b,SCRLOOP
scr2:
          ld a,(de)
          and &CC
          rrca
          rrca
          ld c,a
          ld a,(hl)
          and &33
          add a,a
          add a,a
          or c
          ld (hl),a
          inc hl
          inc de
          ld a,(de)
          and &CC
          rrca
          rrca
          ld c,a
          ld a,(hl)
          and &33
          add a,a
          add a,a
          or c
          ld (hl),a
          inc hl
          inc de
          ld a,(de)
          and &CC
          rrca
          rrca
          ld c,a
          ld a,(hl)
          and &33
          add a,a
          add a,a
          or c
          ld (hl),a
          inc hl
          inc de
          djnz scr2
          ld a,(iy+0)               ; the rightmost byte feeds from off screen
          and &CC
          rrca
          rrca
          ld c,a
          ld a,(hl)
          and &33
          add a,a
          add a,a
          or c
          ld (hl),a
          ld a,(iy+0)
          and &33
          add a,a
          add a,a
          ld (iy+0),a
          inc iy
          pop hl
          call nextscan
          push hl
          ld hl,rowcnt
          dec (hl)
          pop hl
          jr nz,scr1
          ret

; Refill the off-screen column with the next half of the next character.
loadcol:  ld a,2
          ld (scrcnt),a
          ld a,(charhalf)
          or a
          jr nz,lc0
          ld hl,(msgptr)
          ld a,(hl)
          or a
          jr nz,lc1
          ld hl,message
          ld a,(hl)
lc1:      inc hl
          ld (msgptr),hl
          call glyphof
          ld (scrglyph),hl
lc0:      ld hl,(scrglyph)
          ld de,offcol
          ld b,8
lc2:      push bc
          ld a,(hl)
          push hl
          push de
          call expand2
          pop de
          pop hl
          ld a,(charhalf)
          or a
          ld a,(buf4)
          jr z,lc3
          ld a,(buf4+1)
lc3:      ld (de),a
          inc hl
          inc de
          pop bc
          djnz lc2
          ld a,(charhalf)
          xor 1
          ld (charhalf),a
          ret

; ---------------------------------------------------------------------
animate:  ld a,(tick)
          inc a
          ld (tick),a
          and 3
          ret nz
          ld a,(barbase)
          dec a
          and 15
          ld (barbase),a
          ret

; ---------------------------------------------------------------------
; Data
; ---------------------------------------------------------------------
pentab:   db &54,&4C,&5A,&4B,&54    ; inks 0-3 then the border

bartab:   db &54,&44,&58,&5D,&45,&4D,&4C,&4E
          db &5A,&4E,&4C,&4D,&45,&5D,&58,&44
          db &54,&44,&58,&5D,&45,&4D,&4C,&4E
          db &5A,&4E,&4C,&4D,&45,&5D,&58,&44
          db &54,&44,&58,&5D,&45,&4D,&4C,&4E
          db &5A,&4E,&4C,&4D,&45,&5D,&58,&44

flattab:  db &54,&54,&54,&44,&44,&54    ; ink 0 for the flat bands

balls:    db  6, 70, 1, 2,&FF
          db 34, 96,-1, 3,&F0
          db 60,120, 2,-2,&0F

title:    db "AMSTRAD CPC",0
subtitle: db "RASTER BARS AND A SPRITE OR THREE",0

message:  db "WELCOME TO A LITTLE PIECE OF 1984. "
          db "EVERYTHING ON THIS SCREEN IS Z80 MACHINE CODE TALKING TO A GATE ARRAY "
          db "AND A 6845 CRTC. THE COLOURED BANDS ARE INK 0 BEING CHANGED SIX TIMES "
          db "A FRAME FROM THE INTERRUPT HANDLER. THE BALLS ARE MASKED INTO ONE OR "
          db "BOTH BIT PLANES, WHICH IS WHY THEY COME OUT IN DIFFERENT INKS FROM THE "
          db "SAME SIXTY-FOUR BYTES OF ARTWORK. AND THIS TEXT IS EIGHT SCANLINES OF "
          db "SCREEN MEMORY BEING SHIFTED TWO PIXELS LEFT, FIFTY TIMES A SECOND. "
          db "EDIT THE SOURCE, PRESS ASSEMBLE, AND IT ALL RUNS AGAIN.        ",0

barpos:   db 0
barbase:  db 0
tick:     db 0
curx:     db 0
cury:     db 0
savey:    db 0
rowlen:   db 0
hlcount:  db 0
rowcnt:   db 0
bigflag:  db 0
tmpbyte:  db 0
charhalf: db 0
scrcnt:   db 1
strptr:   dw 0
glyphptr: dw 0
scrglyph: dw 0
msgptr:   dw message
buf4:     ds 4
offcol:   ds 8

; 8x8 font, ASCII 32 (" ") to 90 ("Z"), one row per byte
font:
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &30,&30,&30,&30,&30,&00,&30,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &30,&30,&20,&00,&00,&00,&00,&00
  db &18,&30,&60,&60,&60,&30,&18,&00
  db &60,&30,&18,&18,&18,&30,&60,&00
  db &00,&28,&10,&7C,&10,&28,&00,&00
  db &00,&10,&10,&7C,&10,&10,&00,&00
  db &00,&00,&00,&00,&00,&30,&30,&20
  db &00,&00,&00,&7C,&00,&00,&00,&00
  db &00,&00,&00,&00,&00,&30,&30,&00
  db &06,&0C,&18,&30,&60,&C0,&00,&00
  db &7C,&C6,&CE,&DE,&F6,&E6,&7C,&00
  db &18,&38,&18,&18,&18,&18,&7E,&00
  db &7C,&C6,&06,&1C,&70,&C0,&FE,&00
  db &7C,&C6,&06,&3C,&06,&C6,&7C,&00
  db &1C,&3C,&6C,&CC,&FE,&0C,&1E,&00
  db &FE,&C0,&FC,&06,&06,&C6,&7C,&00
  db &3C,&60,&C0,&FC,&C6,&C6,&7C,&00
  db &FE,&C6,&0C,&18,&30,&30,&30,&00
  db &7C,&C6,&C6,&7C,&C6,&C6,&7C,&00
  db &7C,&C6,&C6,&7E,&06,&0C,&78,&00
  db &00,&30,&30,&00,&30,&30,&00,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &7C,&C6,&0C,&18,&18,&00,&18,&00
  db &00,&00,&00,&00,&00,&00,&00,&00
  db &38,&6C,&C6,&C6,&FE,&C6,&C6,&00
  db &FC,&C6,&C6,&FC,&C6,&C6,&FC,&00
  db &3E,&62,&C0,&C0,&C0,&62,&3E,&00
  db &F8,&66,&63,&63,&63,&66,&F8,&00
  db &FE,&C0,&C0,&F8,&C0,&C0,&FE,&00
  db &FE,&C0,&C0,&F8,&C0,&C0,&C0,&00
  db &3E,&62,&C0,&CF,&C3,&63,&3E,&00
  db &C6,&C6,&C6,&FE,&C6,&C6,&C6,&00
  db &7E,&18,&18,&18,&18,&18,&7E,&00
  db &1F,&06,&06,&06,&C6,&C6,&7C,&00
  db &C6,&CC,&D8,&F0,&D8,&CC,&C6,&00
  db &C0,&C0,&C0,&C0,&C0,&C0,&FE,&00
  db &C6,&EE,&FE,&D6,&C6,&C6,&C6,&00
  db &C6,&E6,&F6,&DE,&CE,&C6,&C6,&00
  db &7C,&C6,&C6,&C6,&C6,&C6,&7C,&00
  db &FC,&C6,&C6,&FC,&C0,&C0,&C0,&00
  db &7C,&C6,&C6,&C6,&DC,&CC,&76,&00
  db &FC,&C6,&C6,&FC,&D8,&CC,&C6,&00
  db &7C,&C6,&C0,&7C,&06,&C6,&7C,&00
  db &FE,&18,&18,&18,&18,&18,&18,&00
  db &C6,&C6,&C6,&C6,&C6,&C6,&7C,&00
  db &C6,&C6,&C6,&C6,&6C,&38,&10,&00
  db &C6,&C6,&C6,&D6,&FE,&EE,&C6,&00
  db &C6,&6C,&38,&10,&38,&6C,&C6,&00
  db &C6,&C6,&6C,&38,&18,&18,&18,&00
  db &FE,&06,&0C,&18,&30,&60,&FE,&00

; 16x16 ball sprite, mode 1, 4 bytes per row
balldata:
  db &00,&11,&88,&00
  db &00,&FF,&FF,&00
  db &11,&FF,&FF,&88
  db &33,&EE,&11,&CC
  db &77,&EE,&00,&EE
  db &77,&EE,&00,&66
  db &77,&EE,&00,&66
  db &EE,&00,&00,&77
  db &EE,&00,&00,&77
  db &66,&00,&00,&66
  db &66,&00,&00,&66
  db &77,&00,&00,&EE
  db &33,&88,&11,&CC
  db &11,&FF,&FF,&88
  db &00,&FF,&FF,&00
  db &00,&11,&88,&00

; nibble -> 2 mode-1 bytes with each pixel doubled
dbltab:
  db &00,&00,&00,&33,&00,&CC,&00,&FF
  db &33,&00,&33,&33,&33,&CC,&33,&FF
  db &CC,&00,&CC,&33,&CC,&CC,&CC,&FF
  db &FF,&00,&FF,&33,&FF,&CC,&FF,&FF
