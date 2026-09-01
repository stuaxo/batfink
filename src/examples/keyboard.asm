; Keyboard -- move a block with the arrow keys.
; Selects a keyboard line by writing to PPI port C, then reads the matrix at
; &F4xx. A clear bit means the key is down.

GA     equ &7F00
SCREEN equ &C000

       org &4000

start: di
       ld sp,&BFF0
       ld bc,GA
       ld a,&8D
       out (c),a
       call setpens

       ld hl,SCREEN
       ld de,SCREEN+1
       ld bc,&3FFF
       ld (hl),0
       ldir

       call draw           ; show it once before the loop

loop:  call vsync
       call draw           ; erase

       ld bc,&F600         ; select keyboard line 0
       out (c),c
       ld b,&F4
       in a,(c)
       ld e,a
       bit 0,e             ; up
       jr nz,nup
       ld a,(py)
       dec a
       ld (py),a
nup:   bit 2,e             ; down
       jr nz,ndn
       ld a,(py)
       inc a
       ld (py),a
ndn:   bit 1,e             ; right
       jr nz,nrt
       ld a,(px)
       inc a
       ld (px),a
nrt:
       ld bc,&F601         ; select keyboard line 1
       out (c),c
       ld b,&F4
       in a,(c)
       bit 0,a             ; left
       jr nz,nlt
       ld a,(px)
       dec a
       ld (px),a
nlt:
       call clamp
       call draw           ; redraw
       jr loop

draw:  ld a,(py)
       ld (krow),a
       ld b,8
k1:    push bc
       ld a,(krow)
       call scraddr
       ld a,(px)
       ld e,a
       ld d,0
       add hl,de
       ld a,&FF
       xor (hl)
       ld (hl),a
       inc hl
       ld a,&FF
       xor (hl)
       ld (hl),a
       ld a,(krow)
       inc a
       ld (krow),a
       pop bc
       djnz k1
       ret

clamp: ld a,(px)
       cp 200
       jr c,cxlo
       xor a
cxlo:  cp 77
       jr c,cxok
       ld a,76
cxok:  ld (px),a
       ld a,(py)
       cp 210
       jr c,cylo
       xor a
cylo:  cp 191
       jr c,cyok
       ld a,190
cyok:  ld (py),a
       ret

vsync: ld bc,&F500
vs1:   in a,(c)
       rra
       jr nc,vs1
       ret

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
       ld a,&44
       out (c),a
       ld bc,GA
       ld a,3
       out (c),a
       ld a,&4B
       out (c),a
       ld bc,GA
       ld a,&10
       out (c),a
       ld a,&54
       out (c),a
       ret

px:    db 36
py:    db 90
krow:  db 0
