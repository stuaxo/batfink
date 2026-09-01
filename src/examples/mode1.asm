; Mode 1 -- 320x200, 4 inks. The everyday CPC screen.
; Paints four vertical bands, one per pen, using the real interleaved screen
; layout: 8 raster lines &800 apart within each character row.

GA     equ &7F00
SCREEN equ &C000

       org &4000

start: di
       ld sp,&BFF0
       ld bc,GA
       ld a,&8D            ; mode 1, ROMs out
       out (c),a
       call setpens

       xor a              ; A = screen line 0..199
line:  push af
       call scraddr       ; -> HL = address of that line
       ld a,&00           ; 20 bytes of pen 0
       call band
       ld a,&F0           ; pen 1
       call band
       ld a,&0F           ; pen 2
       call band
       ld a,&FF           ; pen 3
       call band
       pop af
       inc a
       cp 200
       jr c,line
stop:  jr stop

band:  ld b,20
b1:    ld (hl),a
       inc hl
       djnz b1
       ret

; A (0..199) -> HL, address of that screen line
scraddr:
       push af
       and 7
       add a,a
       add a,a
       add a,a            ; (line AND 7) * 8  == high byte of (line AND 7)*&800
       ld h,a
       ld l,0
       pop af
       rrca
       rrca
       rrca
       and &1F            ; line / 8  (0..24)
       ld e,a
       ld d,0
       ex de,hl           ; DE = (line AND 7)*&800, HL = line/8
       add hl,hl
       add hl,hl
       add hl,hl
       add hl,hl          ; *16
       ld b,h
       ld c,l
       add hl,hl
       add hl,hl          ; *64
       add hl,bc          ; *80
       add hl,de
       ld de,SCREEN
       add hl,de
       ret

setpens:
       ld hl,pentab
       ld bc,GA
       ld e,0
sp1:   out (c),e
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

pentab: db &44,&4A,&4C,&4B,&54   ; blue, pastel yellow, bright red, white, border
