; Sound -- a plucked arpeggio on the AY-3-8912.
; A 50 Hz interrupt steps through a note table, poking the PSG through the PPI.
; Each note retriggers the hardware envelope for a decay, and flashes the border.
; Turn sound on with the button under the screen.

GA      equ &7F00
SCREEN  equ &C000

        org &4000

start:  di
        ld sp,&BFF0
        im 1
        ld a,&C3
        ld (&0038),a
        ld hl,irq
        ld (&0039),hl

        ld bc,GA
        ld a,&8D              ; mode 1, ROMs paged out
        out (c),a

        ld hl,SCREEN          ; clear the screen to pen 0
        ld de,SCREEN+1
        ld bc,&3FFF
        ld (hl),0
        ldir
        ld bc,GA             ; pen 0 = dark blue
        xor a
        out (c),a
        ld a,&44
        out (c),a

        ld d,11              ; R11/R12: envelope period ~0x0240
        ld e,&40
        call psg
        ld d,12
        ld e,&02
        call psg
        ld d,7              ; R7 mixer: tone A on, everything else off
        ld e,&3E
        call psg
        ld d,8             ; R8: channel A follows the envelope
        ld e,&10
        call psg

        ei
loop:   jr loop

; ---------------------------------------------------------------------
irq:    push af
        push bc
        push de
        push hl

        ld a,(tick)
        inc a
        ld (tick),a
        cp 12               ; a new note every 12 frames
        jr c,done
        xor a
        ld (tick),a

        ld hl,noteidx      ; advance the note index, wrap at 8
        ld a,(hl)
        inc a
        and 7
        ld (hl),a
        add a,a
        ld e,a
        ld d,0
        ld hl,notes
        add hl,de
        ld c,(hl)
        inc hl
        ld b,(hl)         ; bc = tone period

        push bc
        ld d,0            ; R0 = period low
        ld e,c
        call psg
        pop bc
        ld d,1           ; R1 = period high
        ld e,b
        call psg
        ld d,13         ; R13 = 0: retrigger the envelope (decay)
        ld e,0
        call psg

        ld bc,GA        ; flash the border with the note
        ld a,&10
        out (c),a
        ld a,(noteidx)
        add a,&48
        out (c),a
done:
        pop hl
        pop de
        pop bc
        pop af
        ei
        ret

; D = register number, E = value
psg:    ld bc,&F400
        out (c),d
        ld bc,&F6C0
        out (c),c        ; port C: latch address
        ld bc,&F600
        out (c),c        ; inactive
        ld bc,&F400
        out (c),e
        ld bc,&F680
        out (c),c        ; port C: write
        ld bc,&F600
        out (c),c        ; inactive
        ret

tick:    db 0
noteidx: db 7
notes:   dw 478, 379, 319, 239, 319, 379, 478, 239   ; C3 E3 G3 C4 G3 E3 C3 C4
