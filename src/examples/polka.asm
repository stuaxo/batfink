; Polka -- a grid of dots on cloth, filling the screen.
; Mode 1, four inks: white paper and three blues. A staggered grid of
; circles is drawn once at start-up; each row's left and right edges are
; masked to the pixel, so the dots stay round at this resolution. They
; run off every edge and the raster paints the border the paper colour,
; so there is no black frame. The animation is all palette:
;   * the interrupt runs a raster the full height, paper rewritten every
;     few scanlines from a gradient -- a soft wash of light over the
;     cloth -- and it scrolls;
;   * the three dot inks rotate through a blue ramp one step at a time,
;     so colour drifts diagonally across the grid.

GA     equ &7F00
PPI_B  equ &F500
RAD    equ 20              ; dot vertical radius, scanlines
STEPS  equ 8               ; raster changes per band (6 bands cover the frame)
DELAY  equ 95              ; inner delay between them, ~one band / STEPS

       org &4000

start: di

; Clear 16K by pushing zeros -- ~3x faster than LDIR, so the screen is
; up in about one frame instead of four. Done first, while SP is free.
       ld hl,0
       ld sp,0                   ; push wraps down from &0000 through &C000..&FFFF
       ld c,4
clr0:  ld b,0
clr1:  push hl
       push hl
       push hl
       push hl
       push hl
       push hl
       push hl
       push hl
       djnz clr1
       dec c
       jr nz,clr0

       ld sp,&BFF0
       im 1
       ld a,&C3
       ld (&0038),a
       ld hl,irq
       ld (&0039),hl

       ld bc,GA
       ld a,&8D                  ; mode 1, both ROMs paged out
       out (c),a
       xor a                     ; pen 0 = paper, until the raster runs
       out (c),a
       ld a,&4B
       out (c),a

       call setwarm             ; pens 1-3 = the blue ramp
       call drawdots
       ei

; ---------------------------------------------------------------------
; Main loop. The rasters live in the interrupt; here we just nudge the
; two slow phases, each on its own divider.
; ---------------------------------------------------------------------
main:  call waitvsync
       ld a,5                  ; re-phase: next interrupt is band 0, at the top
       ld (barpos),a

; --- dot ramp: rotate one step every 12 frames.
       ld hl,cctick
       inc (hl)
       ld a,(hl)
       cp 12
       jr c,gr
       ld (hl),0
       ld hl,phase
       inc (hl)
       call setwarm

; --- gradient scroll: one step every 5 frames.
gr:    ld hl,grtick
       inc (hl)
       ld a,(hl)
       cp 5
       jr c,main
       ld (hl),0
       ld hl,grphase
       inc (hl)
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
       and 31                    ; grad[] is 32 long -- mask, don't loop
       ld l,a
       ld h,0
       ld de,grad
       add hl,de
       ld a,(hl)
       ld bc,GA
       ld e,a
       out (c),c                 ; pen 0 (paper)
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
; Pens 1-3 from warm[], rotated by phase.
; ---------------------------------------------------------------------
setwarm:
       ld a,1
       ld (cpn),a
sw1:   ld a,(phase)
       ld hl,cpn
       add a,(hl)
       dec a
       and 3                     ; index into warm[], mod 4 (a power of two)
       ld e,a
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
       cp 4
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

; ---------------------------------------------------------------------
; Dots. Each record: centre x (in 2-pixel units), centre y (line), pen.
; ---------------------------------------------------------------------
drawdots:
       ld ix,dots
       ld b,28
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
       inc hl                    ; -> dady
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
       inc hl                    ; -> dady
       inc (hl)
       pop bc
       djnz dt2
       ret

; One scanline of the current dot. Left and right ends are masked to the
; pixel; the bytes between are solid.
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
       ld c,a                    ; c = half-width, pixels

       ld a,(dcx)
       add a,a
       ld l,a
       ld a,0
       adc a,0
       ld h,a                    ; hl = centre pixel (0..320)

       ld a,l                    ; left = centre - c, clamped to 0
       sub c
       ld e,a
       ld a,h
       sbc a,0
       jr nc,dro0
       xor a
       ld e,a
dro0:  ld d,a                    ; de = left pixel

       ld a,l                    ; right = centre + c, clamped to 319
       add a,c
       ld l,a
       ld a,h
       adc a,0
       ld h,a
       cp 1
       jr c,dro1
       jr nz,dro2
       ld a,l
       cp &40
       jr c,dro1
dro2:  ld hl,319
dro1:
       ld a,e                    ; split left into byte + pixel
       and 3
       ld (lsub),a
       srl d
       rr e
       srl d
       rr e
       ld a,e
       ld (curx),a               ; left byte

       ld a,l                    ; split right into byte + pixel
       and 3
       ld (rsub),a
       srl h
       rr l
       srl h
       rr l
       ld a,l                    ; right byte
       ld hl,curx
       sub (hl)
       ld (midc),a               ; right byte - left byte

       ld a,(lsub)
       ld l,a
       ld h,0
       ld de,nleftmask
       add hl,de
       ld a,(hl)
       ld (nmL),a
       ld a,(rsub)
       ld l,a
       ld h,0
       ld de,nrightmask
       add hl,de
       ld a,(hl)
       ld (nmR),a

       call scraddr              ; hl = left byte address
       ld a,(midc)
       or a
       jr nz,drm

       ld a,(nmL)                ; single byte: keep both fringes
       ld b,a
       ld a,(nmR)
       or b
       jp rmw

drm:   ld a,(nmL)
       call rmw
       inc hl
       ld a,(midc)
       dec a
       jr z,drr
       ld b,a
       ld a,(fillbyte)
drmid: ld (hl),a
       inc hl
       djnz drmid
drr:   ld a,(nmR)
       jp rmw

; HL -> screen byte, A = keep mask. Byte becomes (old & keep) | (fill & ~keep).
rmw:   ld b,a
       ld a,(hl)
       and b
       ld c,a
       ld a,b
       cpl
       ld b,a
       ld a,(fillbyte)
       and b
       or c
       ld (hl),a
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
; Solid mode-1 byte (all four pixels one pen) for pens 0-3.
solidtab: db &00,&F0,&0F,&FF

; Circle half-width per row, in pixels, stretched 1.2x for the mode-1
; pixel aspect (pixels are taller than wide) so the dots read as round.
hwtab:    db 23,23,23,22,22,22,22,21,21,20,19,19,18,17,16,14,13,11,8,0,0

; Pixels to KEEP (not fill) in the left / right fringe byte, indexed by
; the sub-pixel where the run starts / ends.
nleftmask:  db &00,&88,&CC,&EE
nrightmask: db &77,&33,&11,&00

; The three dot inks, GA slots: blue, bright blue, sky blue, bright blue
; -- a short there-and-back ramp, so the rotation reads as a soft wave.
warm:     db &44,&55,&57,&55

; The paper wash, GA slots: bright white with two soft swells of pastel
; cyan -- a moving sheen, low contrast, never dark. 32 samples, scrolled
; by grphase.
grad:     db &4B,&4B,&4B,&4B,&49,&49,&49,&49,&49,&4B,&4B,&4B,&4B,&4B,&4B,&4B
          db &4B,&4B,&4B,&49,&49,&49,&49,&4B,&4B,&4B,&4B,&4B,&4B,&4B,&4B,&4B

; Start index into grad[] for each band (band * STEPS mod 32).
barbase:  db 0,8,16,24,0,8

; Staggered grid that runs off every edge, pens spread on a diagonal so
; the ramp rotation reads as a wave. Record: centre x (2-pixel units),
; centre y, pen.
dots:     db   0,  0,1,  32,  0,2,  64,  0,3,  96,  0,1, 128,  0,2, 160,  0,3
          db  16, 50,2,  48, 50,3,  80, 50,1, 112, 50,2, 144, 50,3
          db   0,100,3,  32,100,1,  64,100,2,  96,100,3, 128,100,1, 160,100,2
          db  16,150,1,  48,150,2,  80,150,3, 112,150,1, 144,150,2
          db   0,200,2,  32,200,3,  64,200,1,  96,200,2, 128,200,3, 160,200,1

phase:    db 0
cctick:   db 0
grphase:  db 0
grtick:   db 0
gidx:     db 0
stepc:    db 0
barpos:   db 0
cpn:      db 0
cpcol:    db 0
dcx:      db 0
dcy:      db 0
dline:    db 0                    ; dline then dady -- dot() steps both via one HL
dady:     db 0
fillbyte: db 0
lsub:     db 0
rsub:     db 0
midc:     db 0
nmL:      db 0
nmR:      db 0
curx:     db 0
cury:     db 0
