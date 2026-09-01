; Sprite -- a block travelling across a mode 1 screen.
; Drawn with XOR, so drawing the same shape in the same place clears it: each
; frame erases the sprite, moves it, and draws it at the new position.

GA     equ &7F00
SCREEN equ &C000

       org &4000

start: di
       ld sp,&BFF0
       ld bc,GA
       ld a,&8D            ; mode 1, ROMs out
       out (c),a
       call setpens

       ld hl,SCREEN        ; clear the screen to pen 0
       ld de,SCREEN+1
       ld bc,&3FFF
       ld (hl),0
       ldir

       call draw           ; show it once before the loop

loop:  call vsync
       call draw           ; erase at the current position

       ld a,(sx)           ; step right, wrap round
       inc a
       cp 78
       jr c,sxok
       xor a
sxok:  ld (sx),a

       ld a,(tick)
       inc a
       ld (tick),a
       and 1
       jr nz,noy           ; step down every other frame
       ld a,(sy)
       inc a
       cp 190
       jr c,syok
       xor a
syok:  ld (sy),a
noy:
       call draw           ; draw at the new position
       jr loop

; XOR the 8x8 sprite in at (sx, sy)
draw:  ld a,(sy)
       ld (row),a
       ld ix,sprite
       ld b,8
d1:    push bc
       ld a,(row)
       call scraddr        ; HL = line address
       ld a,(sx)
       ld e,a
       ld d,0
       add hl,de
       ld a,(ix+0)
       xor (hl)
       ld (hl),a
       inc hl
       ld a,(ix+1)
       xor (hl)
       ld (hl),a
       inc ix
       inc ix
       ld a,(row)
       inc a
       ld (row),a
       pop bc
       djnz d1
       ret

vsync: ld bc,&F500
vs1:   in a,(c)
       rra
       jr nc,vs1
       ret

; A (0..199) -> HL, address of that screen line
scraddr:
       push af
       and 7
       add a,a
       add a,a
       add a,a
       ld h,a
       ld l,0
       pop af
       rrca
       rrca
       rrca
       and &1F
       ld e,a
       ld d,0
       ex de,hl
       add hl,hl
       add hl,hl
       add hl,hl
       add hl,hl
       ld b,h
       ld c,l
       add hl,hl
       add hl,hl
       add hl,bc
       add hl,de
       ld de,SCREEN
       add hl,de
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
       ld a,&4B           ; pen 3 = bright white
       out (c),a
       ld bc,GA
       ld a,&10
       out (c),a
       ld a,&54           ; border = black
       out (c),a
       ret

sx:    db 4
sy:    db 30
row:   db 0
tick:  db 0

sprite:
       db &FF,&FF
       db &FF,&FF
       db &FF,&00
       db &00,&FF
       db &FF,&00
       db &00,&FF
       db &FF,&FF
       db &FF,&FF
