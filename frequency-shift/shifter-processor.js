// shifter-processor.js
class FrequencyShifter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    // Hilbert coefficients for 90-degree phase splitting
    this.a1 = [0.699084, 0.915054, 0.977202, 0.995055];
    this.b1 = [0, 0, 0, 0];
    this.a2 = [0.130541, 0.563059, 0.864356, 0.969680];
    this.b2 = [0, 0, 0, 0];
  }

  static get parameterDescriptors() {
    return [{ name: 'shift', defaultValue: 50, minValue: -2000, maxValue: 2000 }];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0][0]; // Mono input
    const output = outputs[0][0];
    const shift = parameters.shift;

    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      const freq = shift.length > 1 ? shift[i] : shift[0];
      
      // Update quadrature oscillator
      this.phase += (2 * Math.PI * freq) / sampleRate;
      const cos = Math.cos(this.phase);
      const sin = Math.sin(this.phase);

      // Simple All-pass IIR Hilbert approximation
      let x = input[i];
      let out1 = x;
      let out2 = x;

      // Filter stages
      for (let j = 0; j < 4; j++) {
        let tmp = (out1 - this.b1[j]) * this.a1[j] + this.b1[j];
        this.b1[j] = out1;
        out1 = tmp;

        tmp = (out2 - this.b2[j]) * this.a2[j] + this.b2[j];
        this.b2[j] = out2;
        out2 = tmp;
      }

      // Single Sideband Modulation formula: 
      // Output = (Real * Cos) - (Imaginary * Sin)
      output[i] = (out1 * cos) - (out2 * sin);
    }
    return true;
  }
}

registerProcessor('shifter-processor', FrequencyShifter);
