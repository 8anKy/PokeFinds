;; BILDSÖKNINGENS KÄRNA (2026-11-28) — heltalsskalärprodukter mellan frågeavtryck och indexrader,
;; 16 byte i taget (WebAssembly SIMD). Ersätter den innersta JS-loopen i art-index.ts, som mätt i
;; drift kostade ~360 ms per live-poll och ~1,9 s per skanning.
;;
;; ⛔ KÄRNAN RÄKNAR BARA HELTAL. Normalisering, blandning (BLEND_*) och topplistan ligger kvar i
;;    JS med samma aritmetik i samma ordning ⇒ samma poäng bit för bit (art-index-kernel.test.ts).
;; ⛔ Ändras filen: `node scripts/build-art-kernel.mjs` — testet fäller en glömd ombyggnad.
;;
;; Minnet ägs av JS (art-index.ts lägger frågor, utdata och hela indexet i det). Taket 4 096 sidor
;; = 256 MB ≈ 200 000 kort; ryms indexet inte faller art-index.ts tillbaka på JS-loopen.
(module
  (memory (export "mem") 1 4096)

  ;; Skalärprodukten av två int8-vektorer. Varje produkt ryms i i16 (|v| <= 128), parsummorna
  ;; i i32; längsta vektorn här är 704 byte ⇒ ingen överlöpning.
  (func $dot (param $a i32) (param $b i32) (param $len i32) (result i32)
    (local $acc v128)
    (local $va v128)
    (local $vb v128)
    (local $end i32)
    (local $s i32)
    (local.set $end (i32.add (local.get $a) (i32.and (local.get $len) (i32.const -16))))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $a) (local.get $end)))
        (local.set $va (v128.load align=1 (local.get $a)))
        (local.set $vb (v128.load align=1 (local.get $b)))
        (local.set $acc
          (i32x4.add
            (local.get $acc)
            (i32x4.add
              (i32x4.dot_i16x8_s
                (i16x8.extend_low_i8x16_s (local.get $va))
                (i16x8.extend_low_i8x16_s (local.get $vb)))
              (i32x4.dot_i16x8_s
                (i16x8.extend_high_i8x16_s (local.get $va))
                (i16x8.extend_high_i8x16_s (local.get $vb))))))
        (local.set $a (i32.add (local.get $a) (i32.const 16)))
        (local.set $b (i32.add (local.get $b) (i32.const 16)))
        (br $next)))
    (local.set $s
      (i32.add
        (i32.add (i32x4.extract_lane 0 (local.get $acc)) (i32x4.extract_lane 1 (local.get $acc)))
        (i32.add (i32x4.extract_lane 2 (local.get $acc)) (i32x4.extract_lane 3 (local.get $acc)))))
    ;; Resten (len mod 16), en byte i taget.
    (local.set $end (i32.add (local.get $a) (i32.and (local.get $len) (i32.const 15))))
    (block $tailDone
      (loop $tail
        (br_if $tailDone (i32.ge_u (local.get $a) (local.get $end)))
        (local.set $s
          (i32.add
            (local.get $s)
            (i32.mul (i32.load8_s (local.get $a)) (i32.load8_s (local.get $b)))))
        (local.set $a (i32.add (local.get $a) (i32.const 1)))
        (local.set $b (i32.add (local.get $b) (i32.const 1)))
        (br $tail)))
    (local.get $s))

  ;; För raderna [row, row+count) och frågorna [0, nq): tre skalärprodukter per (fråga, rad) —
  ;; färg (fb byte), struktur-DCT (sd byte), struktur-gradient (sg byte).
  ;;   fråga qi ligger på  q + qi*(fb+sd+sg)   (färg, sedan struktur)
  ;;   rad r     ligger på  data + r*fb  resp.  struct + r*(sd+sg)
  ;;   utdata    i32 på     out + ((qi*count + (r-row))*3 + {0,1,2})*4
  ;; Raden läses EN gång för alla frågor (den ligger kvar i cachen), så hela indexet gås igenom
  ;; en gång per sökning oavsett antal frågor.
  (func (export "dots")
    (param $data i32) (param $struct i32) (param $row i32) (param $count i32)
    (param $q i32) (param $nq i32) (param $out i32)
    (param $fb i32) (param $sd i32) (param $sg i32)
    (local $r i32)
    (local $qi i32)
    (local $dp i32)
    (local $sp i32)
    (local $qp i32)
    (local $o i32)
    (local $qsize i32)
    (local $ssize i32)
    (local.set $ssize (i32.add (local.get $sd) (local.get $sg)))
    (local.set $qsize (i32.add (local.get $fb) (local.get $ssize)))
    (local.set $r (i32.const 0))
    (block $rowsDone
      (loop $rows
        (br_if $rowsDone (i32.ge_u (local.get $r) (local.get $count)))
        (local.set $dp
          (i32.add (local.get $data)
            (i32.mul (i32.add (local.get $row) (local.get $r)) (local.get $fb))))
        (local.set $sp
          (i32.add (local.get $struct)
            (i32.mul (i32.add (local.get $row) (local.get $r)) (local.get $ssize))))
        (local.set $qi (i32.const 0))
        (block $queriesDone
          (loop $queries
            (br_if $queriesDone (i32.ge_u (local.get $qi) (local.get $nq)))
            (local.set $qp (i32.add (local.get $q) (i32.mul (local.get $qi) (local.get $qsize))))
            (local.set $o
              (i32.add (local.get $out)
                (i32.mul
                  (i32.add (i32.mul (local.get $qi) (local.get $count)) (local.get $r))
                  (i32.const 12))))
            (i32.store (local.get $o)
              (call $dot (local.get $qp) (local.get $dp) (local.get $fb)))
            (i32.store offset=4 (local.get $o)
              (call $dot
                (i32.add (local.get $qp) (local.get $fb))
                (local.get $sp)
                (local.get $sd)))
            (i32.store offset=8 (local.get $o)
              (call $dot
                (i32.add (i32.add (local.get $qp) (local.get $fb)) (local.get $sd))
                (i32.add (local.get $sp) (local.get $sd))
                (local.get $sg)))
            (local.set $qi (i32.add (local.get $qi) (i32.const 1)))
            (br $queries)))
        (local.set $r (i32.add (local.get $r) (i32.const 1)))
        (br $rows)))))
