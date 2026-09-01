; Scroller -- hardware horizontal scroll.
; Paints vertical bars, then bumps CRTC register 13 (the display start address)
; once per frame. The Gate Array fetches from a different point each frame, so
; the whole picture slides sideways for almost no CPU cost.

GA     equ &7F00
SCREEN equ &C000

       org &4000

start: di
       ld sp,&BFF0
       ld bc,GA
       ld a,&8D
       out (c),a
       call setpens

       ld hl,SCREEN        ; 16px bars: alternate runs of pen 0 and pen 3
fill:  ld a,l
       and 4
       jr z,f0
       ld a,&FF
       jr fw
f0:    xor a
fw:    ld (hl),a
       inc hl
       ld a,h
       or a
       jr nz,fill

       ld a,0
scroll:
       push af
       call vsync
       pop af
       inc a
       ld bc,&BC0D        ; select CRTC R13
       out (c),c
       ld b,&BD
       out (c),a          ; new display start, low byte
       jr scroll

vsync: ld bc,&F500
vs1:   in a,(c)
       rra
       jr nc,vs1
       ret

setpens:
       ld bc,GA
       xor a
       out (c),a
       ld a,&44           ; pen 0 = blue
       out (c),a
       ld bc,GA
       ld a,3
       out (c),a
       ld a,&4E           ; pen 3 = orange
       out (c),a
       ld bc,GA
       ld a,&10
       out (c),a
       ld a,&54
       out (c),a
       ret
