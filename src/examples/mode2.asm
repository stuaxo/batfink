; Mode 2 -- 640x200, 2 inks. The high-resolution mode: one bit per pixel.
; Fills the screen with a byte ramp, so each 8-pixel byte draws a different
; bit pattern and the resolution is obvious.

GA     equ &7F00
SCREEN equ &C000

       org &4000

start: di
       ld sp,&BFF0
       ld bc,GA
       ld a,&8E            ; mode 2, ROMs out
       out (c),a

       ld bc,GA           ; pen 0 = navy, pen 1 = bright yellow
       xor a
       out (c),a
       ld a,&54
       out (c),a
       ld bc,GA
       ld a,1
       out (c),a
       ld a,&4A
       out (c),a
       ld bc,GA           ; border = navy
       ld a,&10
       out (c),a
       ld a,&54
       out (c),a

       ld hl,SCREEN
fill:  ld a,l
       ld (hl),a
       inc hl
       ld a,h
       or a
       jr nz,fill

spin:  jr spin
