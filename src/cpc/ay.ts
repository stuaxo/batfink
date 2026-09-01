// AY-3-8912 / YM2149 sound chip. A faithful TypeScript port of ayumi by Peter
// Sovietov (github.com/true-grue/ayumi, MIT) — tone/noise/envelope generators,
// the logarithmic DAC, band-limited resampling and a DC blocker. See NOTICE.
//
// writeReg() on top maps the 16 CPC registers onto the ayumi controls.

const TONE_CHANNELS = 3;
const DECIMATE_FACTOR = 8;
const FIR_SIZE = 192;
const DC_FILTER_SIZE = 1024;

const AY_DAC = [
  0.0, 0.0, 0.00999465934234, 0.00999465934234, 0.0144502937362, 0.0144502937362,
  0.0210574502174, 0.0210574502174, 0.0307011520562, 0.0307011520562,
  0.0455481803616, 0.0455481803616, 0.0644998855573, 0.0644998855573,
  0.107362478065, 0.107362478065, 0.126588845655, 0.126588845655,
  0.20498970016, 0.20498970016, 0.292210269322, 0.292210269322,
  0.372838941024, 0.372838941024, 0.492530708782, 0.492530708782,
  0.635324635691, 0.635324635691, 0.805584802014, 0.805584802014, 1.0, 1.0,
];
const YM_DAC = [
  0.0, 0.0, 0.00465400167849, 0.00772106507973, 0.0109559777218, 0.0139620050355,
  0.0169985503929, 0.0200198367285, 0.024368657969, 0.029694056611,
  0.0350652323186, 0.0403906309606, 0.0485389486534, 0.0583352407111,
  0.0680552376593, 0.0777752346075, 0.0925154497597, 0.111085679408,
  0.129747463188, 0.148485542077, 0.17666895552, 0.211551079576,
  0.246387426566, 0.281101701381, 0.333730067903, 0.400427252613,
  0.467383840696, 0.53443198291, 0.635172045472, 0.75800717174, 0.879926756695, 1.0,
];

// Envelope segment kinds.
const SD = 0; // slide down
const SU = 1; // slide up
const HT = 2; // hold top
const HB = 3; // hold bottom
const ENVELOPES: readonly [number, number][] = [
  [SD, HB], [SD, HB], [SD, HB], [SD, HB],
  [SU, HB], [SU, HB], [SU, HB], [SU, HB],
  [SD, SD], [SD, HB], [SD, SU], [SD, HT],
  [SU, SU], [SU, HT], [SU, SD], [SU, HB],
];

// FIR half-band decimation kernel (from ayumi).
const FIR: readonly number[] = [
  -0.0000046183113992051936, -0.00001117761640887225, -0.000018610264502005432,
  -0.000025134586135631012, -0.000028494281690666197, -0.000026396828793275159,
  -0.000017094212558802156, 0.000023798193576966866, 0.000051281160242202183,
  0.00007762197826243427, 0.000096759426664120416, 0.00010240229300393402,
  0.000089344614218077106, 0.000054875700118949183, -0.000069839082210680165,
  -0.0001447966132360757, -0.00021158452917708308, -0.00025535069106550544,
  -0.00026228714374322104, -0.00022258805927027799, -0.00013323230495695704,
  0.00016182578767055206, 0.00032846175385096581, 0.00047045611576184863,
  0.00055713851457530944, 0.00056212565121518726, 0.00046901918553962478,
  0.00027624866838952986, -0.00032564179486838622, -0.00065182310286710388,
  -0.00092127787309319298, -0.0010772534348943575, -0.0010737727700273478,
  -0.00088556645390392634, -0.00051581896090765534, 0.00059548767193795277,
  0.0011803558710661009, 0.0016527320270369871, 0.0019152679330965555,
  0.0018927324805381538, 0.0015481870327877937, 0.00089470695834941306,
  -0.0010178225878206125, -0.0020037400552054292, -0.0027874356824117317,
  -0.003210329988021943, -0.0031540624117984395, -0.0025657163651900345,
  -0.0014750752642111449, 0.0016624165446378462, 0.0032591192839069179,
  0.0045165685815867747, 0.0051838984346123896, 0.0050774264697459933,
  0.0041192521414141585, 0.0023628575417966491, -0.0026543507866759182,
  -0.0051990251084333425, -0.0072020238234656924, -0.0082672928192007358,
  -0.0081033739572956287, -0.006583111539570221, -0.0037839040415292386,
  0.0042781252851152507, 0.0084176358598320178, 0.01172566057463055,
  0.013550476647788672, 0.013388189369997496, 0.010979501242341259,
  0.006381274941685413, -0.007421229604153888, -0.01486456304340213,
  -0.021143584622178104, -0.02504275058758609, -0.025473530942547201,
  -0.021627310017882196, -0.013104323383225543, 0.017065133989980476,
  0.036978919264451952, 0.05823318062093958, 0.079072012081405949,
  0.097675998716952317, 0.11236045936950932, 0.12176343577287731, 0.125,
];

interface Channel {
  tonePeriod: number;
  toneCounter: number;
  tone: number;
  tOff: number;
  nOff: number;
  eOn: number;
  volume: number;
  panLeft: number;
  panRight: number;
}

export class Ay {
  left = 0;
  right = 0;

  private readonly channels: Channel[] = Array.from({ length: TONE_CHANNELS }, () => ({
    tonePeriod: 1, toneCounter: 0, tone: 0,
    tOff: 0, nOff: 0, eOn: 0, volume: 0, panLeft: 0.5, panRight: 0.5,
  }));
  private noisePeriod = 1;
  private noiseCounter = 0;
  private noise = 1;
  private envCounter = 0;
  private envPeriod = 1;
  private envShape = 0;
  private envSegment = 0;
  private envelope = 0;
  private dac: readonly number[] = AY_DAC;
  private step = 0;
  private x = 0;

  private readonly cLeft = new Float64Array(4);
  private readonly yLeft = new Float64Array(4);
  private readonly cRight = new Float64Array(4);
  private readonly yRight = new Float64Array(4);
  private readonly firLeft = new Float64Array(FIR_SIZE * 2);
  private readonly firRight = new Float64Array(FIR_SIZE * 2);
  private firIndex = 0;
  private readonly dcLeftDelay = new Float64Array(DC_FILTER_SIZE);
  private readonly dcRightDelay = new Float64Array(DC_FILTER_SIZE);
  private dcLeftSum = 0;
  private dcRightSum = 0;
  private dcIndex = 0;

  private readonly regs = new Uint8Array(16);

  constructor(clockHz: number, sampleRate: number, isYM = false) {
    this.step = clockHz / (sampleRate * 8 * DECIMATE_FACTOR);
    this.dac = isYM ? YM_DAC : AY_DAC;
    this.setEnvelopeShape(0);
  }

  // --- ayumi control surface --------------------------------------
  setPan(i: number, pan: number, equalPower = true): void {
    const c = this.channels[i];
    if (equalPower) { c.panLeft = Math.sqrt(1 - pan); c.panRight = Math.sqrt(pan); }
    else { c.panLeft = 1 - pan; c.panRight = pan; }
  }
  setTone(i: number, period: number): void {
    period &= 0xfff;
    this.channels[i].tonePeriod = period === 0 ? 1 : period;
  }
  setNoise(period: number): void {
    period &= 0x1f;
    this.noisePeriod = period === 0 ? 1 : period;
  }
  setMixer(i: number, tOff: number, nOff: number, eOn: number): void {
    const c = this.channels[i];
    c.tOff = tOff & 1; c.nOff = nOff & 1; c.eOn = eOn ? 1 : 0;
  }
  setVolume(i: number, volume: number): void {
    this.channels[i].volume = volume & 0x0f;
  }
  setEnvelope(period: number): void {
    period &= 0xffff;
    this.envPeriod = period === 0 ? 1 : period;
  }
  setEnvelopeShape(shape: number): void {
    this.envShape = shape & 0x0f;
    this.envCounter = 0;
    this.envSegment = 0;
    this.resetSegment();
  }

  // --- the 16 CPC registers -------------------------------------
  writeReg(n: number, value: number): void {
    this.regs[n & 0x0f] = value & 0xff;
    const r = this.regs;
    switch (n & 0x0f) {
      case 0: case 1: this.setTone(0, r[0] | (r[1] << 8)); break;
      case 2: case 3: this.setTone(1, r[2] | (r[3] << 8)); break;
      case 4: case 5: this.setTone(2, r[4] | (r[5] << 8)); break;
      case 6: this.setNoise(value); break;
      case 7:
        for (let i = 0; i < TONE_CHANNELS; i++) {
          this.setMixer(i, (r[7] >> i) & 1, (r[7] >> (i + 3)) & 1, (r[8 + i] >> 4) & 1);
        }
        break;
      case 8: case 9: case 10: {
        const ch = (n & 0x0f) - 8;
        this.setVolume(ch, value & 0x0f);
        this.setMixer(ch, (r[7] >> ch) & 1, (r[7] >> (ch + 3)) & 1, (value >> 4) & 1);
        break;
      }
      case 11: case 12: this.setEnvelope(r[11] | (r[12] << 8)); break;
      case 13: if ((value & 0xff) !== 0xff) this.setEnvelopeShape(value); break;
    }
  }

  reset(): void {
    this.regs.fill(0);
    for (const c of this.channels) {
      c.tonePeriod = 1; c.toneCounter = 0; c.tone = 0;
      c.tOff = 0; c.nOff = 0; c.eOn = 0; c.volume = 0;
    }
    this.noisePeriod = 1; this.noiseCounter = 0; this.noise = 1;
    this.envPeriod = 1; this.setEnvelopeShape(0);
    // resampler + DC filter state
    this.x = 0; this.firIndex = 0; this.dcIndex = 0;
    this.dcLeftSum = 0; this.dcRightSum = 0;
    this.cLeft.fill(0); this.yLeft.fill(0); this.cRight.fill(0); this.yRight.fill(0);
    this.firLeft.fill(0); this.firRight.fill(0);
    this.dcLeftDelay.fill(0); this.dcRightDelay.fill(0);
    this.left = 0; this.right = 0;
  }

  // --- generators ---------------------------------------------
  private resetSegment(): void {
    const kind = ENVELOPES[this.envShape][this.envSegment];
    this.envelope = kind === SD || kind === HT ? 31 : 0;
  }

  private stepEnvelope(): number {
    if (++this.envCounter >= this.envPeriod) {
      this.envCounter = 0;
      const kind = ENVELOPES[this.envShape][this.envSegment];
      if (kind === SU) {
        if (++this.envelope > 31) { this.envSegment ^= 1; this.resetSegment(); }
      } else if (kind === SD) {
        if (--this.envelope < 0) { this.envSegment ^= 1; this.resetSegment(); }
      }
    }
    return this.envelope;
  }

  private stepNoise(): number {
    if (++this.noiseCounter >= this.noisePeriod << 1) {
      this.noiseCounter = 0;
      const bit = (this.noise ^ (this.noise >> 3)) & 1;
      this.noise = (this.noise >> 1) | (bit << 16);
    }
    return this.noise & 1;
  }

  private stepTone(i: number): number {
    const c = this.channels[i];
    if (++c.toneCounter >= c.tonePeriod) { c.toneCounter = 0; c.tone ^= 1; }
    return c.tone;
  }

  private mix(): void {
    const noise = this.stepNoise();
    const env = this.stepEnvelope();
    let l = 0;
    let rr = 0;
    for (let i = 0; i < TONE_CHANNELS; i++) {
      const c = this.channels[i];
      let out = (this.stepTone(i) | c.tOff) & (noise | c.nOff);
      out *= c.eOn ? env : c.volume * 2 + 1;
      l += this.dac[out] * c.panLeft;
      rr += this.dac[out] * c.panRight;
    }
    this.left = l;
    this.right = rr;
  }

  private decimate(fir: Float64Array, base: number): number {
    // half-band FIR: pairs x[j]+x[192-j] for j = 1..95 excluding multiples of 8,
    // plus 0.125 * x[96].
    let y = 0;
    let ci = 0;
    for (let group = 0; group < 12; group++) {
      for (let k = 0; k < 7; k++) {
        const j = group * 8 + 1 + k;
        y += FIR[ci++] * (fir[base + j] + fir[base + 192 - j]);
      }
    }
    y += FIR[ci] * fir[base + 96];
    fir.copyWithin(base + FIR_SIZE - DECIMATE_FACTOR, base, base + DECIMATE_FACTOR);
    return y;
  }

  /** Advance one output sample; result in `left` / `right`. */
  process(): void {
    const cL = this.cLeft;
    const yL = this.yLeft;
    const cR = this.cRight;
    const yR = this.yRight;
    const firBase = FIR_SIZE - this.firIndex * DECIMATE_FACTOR;
    this.firIndex = (this.firIndex + 1) % (FIR_SIZE / DECIMATE_FACTOR - 1);

    for (let i = DECIMATE_FACTOR - 1; i >= 0; i--) {
      this.x += this.step;
      if (this.x >= 1) {
        this.x -= 1;
        yL[0] = yL[1]; yL[1] = yL[2]; yL[2] = yL[3];
        yR[0] = yR[1]; yR[1] = yR[2]; yR[2] = yR[3];
        this.mix();
        yL[3] = this.left;
        yR[3] = this.right;
        let y1 = yL[2] - yL[0];
        cL[0] = 0.5 * yL[1] + 0.25 * (yL[0] + yL[2]);
        cL[1] = 0.5 * y1;
        cL[2] = 0.25 * (yL[3] - yL[1] - y1);
        y1 = yR[2] - yR[0];
        cR[0] = 0.5 * yR[1] + 0.25 * (yR[0] + yR[2]);
        cR[1] = 0.5 * y1;
        cR[2] = 0.25 * (yR[3] - yR[1] - y1);
      }
      this.firLeft[firBase + i] = (cL[2] * this.x + cL[1]) * this.x + cL[0];
      this.firRight[firBase + i] = (cR[2] * this.x + cR[1]) * this.x + cR[0];
    }
    this.left = this.decimate(this.firLeft, firBase);
    this.right = this.decimate(this.firRight, firBase);
  }

  /** DC blocker; call after process(). */
  removeDc(): void {
    this.dcLeftSum += -this.dcLeftDelay[this.dcIndex] + this.left;
    this.dcLeftDelay[this.dcIndex] = this.left;
    this.left -= this.dcLeftSum / DC_FILTER_SIZE;

    this.dcRightSum += -this.dcRightDelay[this.dcIndex] + this.right;
    this.dcRightDelay[this.dcIndex] = this.right;
    this.right -= this.dcRightSum / DC_FILTER_SIZE;

    this.dcIndex = (this.dcIndex + 1) & (DC_FILTER_SIZE - 1);
  }
}
