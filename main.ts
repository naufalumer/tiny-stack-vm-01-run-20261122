// tiny stack VM for make.fun's tiny-stack-vm-01 ISA (version 1).
// One run answers every instance of a set: /input/<id>/program.bin +
// input.bin -> /output/<id>/stdout.bin + exit.txt. Semantics follow ISA.md;
// where the page could be read two ways, the reference VM is the rule.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// [opcode, immediate bytes, pops, pushes] for every opcode of the ISA.
const OPS: [number, number, number, number][] = [
  [0, 0, 0, 0], [1, 1, 0, 1], [2, 4, 0, 1], [3, 0, 1, 0], [4, 0, 1, 2],
  [5, 0, 2, 2], [6, 0, 2, 3], [7, 0, 3, 3],
  [16, 0, 2, 1], [17, 0, 2, 1], [18, 0, 2, 1], [19, 0, 2, 1], [20, 0, 2, 1],
  [21, 0, 2, 1], [22, 0, 2, 1], [23, 0, 1, 1], [24, 0, 2, 1], [25, 0, 2, 1],
  [26, 0, 2, 1], [27, 0, 1, 1], [28, 0, 2, 1], [29, 0, 2, 1], [30, 0, 2, 1],
  [32, 0, 2, 1], [33, 0, 2, 1], [34, 0, 2, 1],
  [48, 2, 0, 0], [49, 2, 1, 0], [50, 2, 1, 0], [51, 2, 0, 0], [52, 0, 0, 0],
  [64, 0, 1, 1], [65, 0, 2, 0],
  [80, 0, 1, 0], [81, 0, 1, 0], [82, 0, 0, 1], [83, 0, 1, 0],
];
const META: [number, number, number, number][] = [];
for (const o of OPS) META[o[0]] = o;

// Runs one program on its input. Returns the bytes it wrote and its exit code.
function run(p: Uint8Array, input: Uint8Array): { out: Uint8Array; exit: number } {
  const D = new Int32Array(256); // data stack
  let sp = 0;
  const C = new Int32Array(64); // call stack
  let cp = 0;
  const M = new Int32Array(256); // memory, all zero
  const out = new Uint8Array(65536);
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const n = p.length;
  const done = (exit: number) => ({ out: out.subarray(0, ol), exit });
  for (;;) {
    // One step, in the order ISA.md states it: step limit, pc, opcode,
    // immediate fit, then the instruction (stack checks first, then effect).
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = p[pc];
    const m = META[op];
    if (!m) return done(5);
    const imm = m[1];
    if (pc + imm >= n) return done(9);
    steps++;
    const nx = pc + 1 + imm;
    if (sp < m[2]) return done(2);
    if (sp - m[2] + m[3] > 256) return done(3);
    pc = nx;
    switch (op) {
      case 0: // HALT
        return done(0);
      case 1: // PUSH8, sign-extended
        D[sp++] = (p[nx - 1] << 24) >> 24;
        break;
      case 2: // PUSH32, little-endian signed
        D[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
        break;
      case 3: // POP
        sp--;
        break;
      case 4: // DUP
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 5: { // SWAP
        const t = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = t;
        break;
      }
      case 6: // OVER
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 7: { // ROT: (a b c -- b c a)
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 23: // NEG, wraps: -(-2147483648) is -2147483648
        D[sp - 1] = -D[sp - 1] | 0;
        break;
      case 27: // NOT
        D[sp - 1] = ~D[sp - 1];
        break;
      case 16: case 17: case 18: case 19: case 20: case 21: case 22:
      case 24: case 25: case 26: case 28: case 29: case 30: case 32: case 33: case 34: {
        const b = D[sp - 1];
        const a = D[sp - 2];
        let r = 0;
        switch (op) {
          case 16: r = (a + b) | 0; break;
          case 17: r = (a - b) | 0; break;
          case 18: r = Math.imul(a, b); break;
          case 19: // DIV, signed, truncated toward zero
            if (b === 0) return done(4);
            r = (a / b) | 0;
            break;
          case 20: // MOD, sign of a
            if (b === 0) return done(4);
            r = (a % b) | 0;
            break;
          case 21: // DIVU, unsigned
            if (b === 0) return done(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 22: // MODU, unsigned
            if (b === 0) return done(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 24: r = a & b; break;
          case 25: r = a | b; break;
          case 26: r = a ^ b; break;
          case 28: r = a << (b & 31); break;
          case 29: r = a >> (b & 31); break;
          case 30: r = (a >>> (b & 31)) | 0; break;
          case 32: r = a === b ? 1 : 0; break;
          case 33: r = a < b ? 1 : 0; break;
          case 34: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        }
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 48: case 49: case 50: { // JMP, JZ, JNZ: signed 16-bit offset from next
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 48) {
          const v = D[--sp];
          take = op === 49 ? v === 0 : v !== 0;
        }
        if (take) pc = nx + rel;
        break;
      }
      case 51: // CALL: 64 return addresses held already traps 7
        if (cp === 64) return done(7);
        C[cp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 52: // RET: an empty call stack traps 8
        if (cp === 0) return done(8);
        pc = C[--cp];
        break;
      case 64: { // LOAD
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return done(6);
        D[sp - 1] = M[a];
        break;
      }
      case 65: { // STORE: (v addr --), addr is the top
        const a = D[sp - 1];
        const v = D[sp - 2];
        if (a < 0 || a >= 256) return done(6);
        sp -= 2;
        M[a] = v;
        break;
      }
      case 80: { // PRINT: decimal ASCII, no newline; over the output limit traps 11
        const t = String(D[sp - 1]);
        if (ol + t.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < t.length; i++) out[ol++] = t.charCodeAt(i);
        break;
      }
      case 81: // PUTC: one byte, v AND 255
        if (ol + 1 > 65536) return done(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 82: // IN: next input byte, -1 once the input is used up
        D[sp++] = ip < input.length ? input[ip++] : -1;
        break;
      case 83: // EXIT: code v AND 255
        return done(D[--sp] & 255);
    }
  }
}

for (const id of readdirSync(IN).sort()) {
  const p = readFileSync(join(IN, id, 'program.bin'));
  const input = readFileSync(join(IN, id, 'input.bin'));
  const r = run(p, input); // readFileSync gives a Buffer, which is a Uint8Array
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'stdout.bin'), r.out);
  writeFileSync(join(OUT, id, 'exit.txt'), String(r.exit) + '\n');
}
