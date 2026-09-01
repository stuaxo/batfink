; Mode 0 -- 160x200, 16 inks.
; Fills the screen with a byte ramp so every ink and pixel pairing shows up,
; then sets all 16 pens to a spread of hardware colours.

GA     equ &7F00           ; Gate Array
SCREEN equ &C000

       org &4000

start: di
       ld sp,&BFF0
       ld bc,GA
       ld a,&8C            ; mode 0, both ROMs paged out
       out (c),a

       call setpens

       ld hl,SCREEN        ; fill 16K: each byte = its own low address
fill:  ld a,l
       ld (hl),a
       inc hl
       ld a,h
       or a               ; stop when HL wraps past &FFFF
       jr nz,fill

stop:  jr stop

; --- set pens 0-15 from pentab, then the border ---------------------
setpens:
       ld hl,pentab
       ld bc,GA
       ld e,0
sp1:   out (c),e          ; select pen E
       ld a,(hl)
       out (c),a          ; ...give it a colour (&40 + hardware number)
       inc hl
       inc e
       ld a,e
       cp 16
       jr c,sp1
       ld a,&10           ; select the border
       out (c),a
       ld a,(hl)
       out (c),a
       ret

pentab:
       db &54,&44,&55,&5C,&58,&5D,&4C,&4B
       db &4A,&40,&46,&52,&51,&5B,&4E,&57
       db &54                              ; border
