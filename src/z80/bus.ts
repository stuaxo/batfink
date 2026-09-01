// The seam between the CPU and whatever it is plugged into. The CPC machine
// (src/cpc/machine.ts) is one implementation; a test harness can supply a bare
// 64K array.
export interface Bus {
  read(addr: number): number;
  write(addr: number, value: number): void;
  in(port: number): number;
  out(port: number, value: number): void;
}
