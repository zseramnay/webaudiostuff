// Spectral Filter AudioWorklet — 512-point FFT, overlap-add
// Inspired by Max/MSP "Forbidden Planet"

class SpectralFilterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.fftSize = 512;
        this.halfSize = this.fftSize / 2;
        this.hopSize = 128; // render quantum

        // Spectral mask: 256 bins, default all pass
        this.mask = new Float32Array(this.halfSize);
        this.mask.fill(1);

        // Hann window
        this.window = new Float32Array(this.fftSize);
        for (let i = 0; i < this.fftSize; i++) {
            this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / this.fftSize));
        }

        // Input ring buffer (accumulate incoming samples)
        this.inputBuffer = new Float32Array(this.fftSize);
        this.inputWritePos = 0;
        this.inputCount = 0;

        // Overlap-add output buffer
        this.outputBuffer = new Float32Array(this.fftSize * 2);
        this.outputReadPos = 0;

        // Temp arrays for FFT
        this.real = new Float32Array(this.fftSize);
        this.imag = new Float32Array(this.fftSize);

        // Bit-reverse table
        this.bitRev = new Uint32Array(this.fftSize);
        const bits = Math.log2(this.fftSize);
        for (let i = 0; i < this.fftSize; i++) {
            let rev = 0;
            for (let b = 0; b < bits; b++) rev |= ((i >> b) & 1) << (bits - 1 - b);
            this.bitRev[i] = rev;
        }

        // Twiddle factors
        this.twiddleRe = new Float32Array(this.halfSize);
        this.twiddleIm = new Float32Array(this.halfSize);
        for (let i = 0; i < this.halfSize; i++) {
            this.twiddleRe[i] = Math.cos(-2 * Math.PI * i / this.fftSize);
            this.twiddleIm[i] = Math.sin(-2 * Math.PI * i / this.fftSize);
        }

        // Normalization factor for overlap-add with Hann window
        this.overlapFactor = this.fftSize / this.hopSize;

        this.port.onmessage = (e) => {
            if (e.data.mask) {
                this.mask.set(e.data.mask);
            }
        };
    }

    fft(re, im, inverse) {
        const N = this.fftSize;
        // Bit-reverse permutation
        const tmpRe = new Float32Array(N);
        const tmpIm = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            tmpRe[i] = re[this.bitRev[i]];
            tmpIm[i] = im[this.bitRev[i]];
        }
        re.set(tmpRe);
        im.set(tmpIm);

        // Cooley-Tukey butterflies
        for (let size = 2; size <= N; size *= 2) {
            const halfSize = size / 2;
            const step = N / size;
            for (let i = 0; i < N; i += size) {
                for (let j = 0; j < halfSize; j++) {
                    const k = j * step;
                    const tRe = inverse ? this.twiddleRe[k] : this.twiddleRe[k];
                    const tIm = inverse ? -this.twiddleIm[k] : this.twiddleIm[k];

                    const evenIdx = i + j;
                    const oddIdx = i + j + halfSize;

                    const oddRe = re[oddIdx] * tRe - im[oddIdx] * tIm;
                    const oddIm = re[oddIdx] * tIm + im[oddIdx] * tRe;

                    re[oddIdx] = re[evenIdx] - oddRe;
                    im[oddIdx] = im[evenIdx] - oddIm;
                    re[evenIdx] += oddRe;
                    im[evenIdx] += oddIm;
                }
            }
        }

        if (inverse) {
            for (let i = 0; i < N; i++) {
                re[i] /= N;
                im[i] /= N;
            }
        }
    }

    processFrame() {
        const N = this.fftSize;

        // Window the input
        for (let i = 0; i < N; i++) {
            this.real[i] = this.inputBuffer[i] * this.window[i];
            this.imag[i] = 0;
        }

        // Forward FFT
        this.fft(this.real, this.imag, false);

        // Apply spectral mask
        for (let i = 0; i < this.halfSize; i++) {
            const g = this.mask[i];
            this.real[i] *= g;
            this.imag[i] *= g;
            // Mirror for negative frequencies
            if (i > 0) {
                this.real[N - i] *= g;
                this.imag[N - i] *= g;
            }
        }

        // Inverse FFT
        this.fft(this.real, this.imag, true);

        // Window again and overlap-add into output buffer
        const outLen = this.outputBuffer.length;
        for (let i = 0; i < N; i++) {
            const pos = (this.outputReadPos + i) % outLen;
            this.outputBuffer[pos] += this.real[i] * this.window[i] / (this.overlapFactor * 0.5);
        }
    }

    process(inputs, outputs) {
        const input = inputs[0][0];
        const output = outputs[0][0];
        if (!input || !output) return true;

        const hop = this.hopSize;

        // Push incoming samples into input ring buffer
        for (let i = 0; i < hop; i++) {
            this.inputBuffer[this.inputWritePos] = input[i];
            this.inputWritePos = (this.inputWritePos + 1) % this.fftSize;
        }
        this.inputCount += hop;

        // When we have a full frame, process it
        if (this.inputCount >= this.fftSize) {
            // Rearrange ring buffer into linear order for FFT
            const linear = new Float32Array(this.fftSize);
            for (let i = 0; i < this.fftSize; i++) {
                linear[i] = this.inputBuffer[(this.inputWritePos + i) % this.fftSize];
            }
            this.inputBuffer.set(linear);
            this.inputCount = this.fftSize - hop; // keep overlap

            this.processFrame();
        }

        // Read from overlap-add output buffer
        const outLen = this.outputBuffer.length;
        for (let i = 0; i < hop; i++) {
            const pos = (this.outputReadPos + i) % outLen;
            output[i] = this.outputBuffer[pos];
            this.outputBuffer[pos] = 0; // clear after reading
        }
        this.outputReadPos = (this.outputReadPos + hop) % outLen;

        return true;
    }
}

registerProcessor('spectral-filter', SpectralFilterProcessor);
