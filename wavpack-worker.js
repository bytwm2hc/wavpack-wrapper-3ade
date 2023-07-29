'use strict';
importScripts('wavpack.js');
let fetching_interval = 7; // ms (Immediately if available, default: 5)
let min_sample_duration = 2; // sec
let sample_rate = 44100;
let numChannels = 1;
let decodedamount = 1;
let arrayPointer;
let floatDivisor = 1.0;
let fetched_data_left = new Float32Array(0);
let fetched_data_right = new Float32Array(0);
let min_sample_size = 100;
let end_of_song_reached = false;
let stopped = false;
let is_reading = false;
let pcm_buffer_in_use = false;

const concatFloat32Arrays = (arr1, arr2) => {
    'use strict';
    if (!arr1 || !arr1.length) {
        return arr2 && arr2.slice();
    }
    if (!arr2 || !arr2.length) {
        return arr1 && arr1.slice();
    }
    let out = new Float32Array(arr1.length + arr2.length);
    out.set(arr1);
    out.set(arr2, arr1.length);
    arr1 = new Float32Array(0);
    arr2 = new Float32Array(0);
    return out;
}

/* const makeId = (length) => {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
      counter += 1;
    }
    return result;
} */

const play = (wvData) => {
    'use strict';
    end_of_song_reached = false;
    stopped = false;
    is_reading = false;
    fetched_data_left = new Float32Array(0);
    fetched_data_right = new Float32Array(0);
    const bytes_per_element = Module.HEAP32.BYTES_PER_ELEMENT;
    let data, filename, stream;
    data = new Uint8Array(wvData);
    //filename = makeId(5);
    filename = 'wavpack.wv';
    stream = FS.open(filename, 'w+');
    FS.write(stream, data, 0, data.length, 0);
    FS.close(stream);
    postMessage({
        wvData: wvData
    }, [wvData]);
    wvData = undefined;
    data = undefined;

    if (typeof arrayPointer === 'undefined') {
        arrayPointer = Module._malloc(4096 * bytes_per_element);
    }

    let musicdata = new Int32Array(4096).fill(0);
    Module.HEAP32.set(musicdata, arrayPointer / bytes_per_element);

    // lets initialise the WavPack file so we know its sample rate, number of channels, bytes per sample etc.
    Module.ccall('initialiseWavPack', null, ['string'], [filename]);

    sample_rate = Module.ccall('GetSampleRate', null, [], []);
    //if (sample_rate > 64000) {
    //    fetching_interval = 1;
    //    min_sample_duration = 3;
    //}
    min_sample_size = min_sample_duration * sample_rate;
    postMessage({
        sampleRate: sample_rate
    });

    postMessage({
        numSamples: Module.ccall('GetNumSamples', null, [], [])
    });

    numChannels = Module.ccall('GetNumChannels', null, [], []);

    let bps = Module.ccall('GetBytesPerSample', null, [], []);
    floatDivisor = Math.pow(2, bps * 8 - 1);

    setTimeout(periodicFetch, 0);
}

const periodicFetch = () => {
    'use strict';
    decodedamount = Module.ccall('DecodeWavPackBlock', 'number', ['number', 'number', 'number'], [2, 2, arrayPointer]);

    while (pcm_buffer_in_use) {
        // wait - this shouldn't be called but have as a sanity check, if we are currently adding PCM (decoded) music data to the AudioBuffer context we don't want to overwrite it
        console.log('~');
    }

    pcm_buffer_in_use = true;

    if (decodedamount != 0) {
        let output_array = new Int32Array(Module.HEAP32.buffer, arrayPointer, 4096);

        let floatsLeft = new Float32Array(1024);
        let floatsRight = new Float32Array(1024);

        if (numChannels == 2) {
            for (let i = 2047; i >= 0; i--) {
                if (i % 2 == 0) {
                    floatsLeft[i / 2] = output_array[i] / floatDivisor;
                } else {
                    floatsRight[(i - 1) / 2] = output_array[i] / floatDivisor;
                }
            }
        } else {
            // mono music (1 channel)
            for (let i = 1023; i >= 0; i--) {
                floatsLeft[i] = output_array[i] / floatDivisor;
            }
        }

        try {
            fetched_data_left = concatFloat32Arrays(fetched_data_left, floatsLeft);
            if (numChannels == 2) {
                fetched_data_right = concatFloat32Arrays(fetched_data_right, floatsRight);
            }
        } catch (ignored) {}
    } else {
        // we decoded zero bytes, so end of song reached
        // we fill our decoded music buffer (PCM) with zeroes (silence)
        end_of_song_reached = true;
        let buffergap = min_sample_size - fetched_data_left.length;
        let emptyArray = new Float32Array();

        for (let i = 0; i < buffergap; i++) {
            emptyArray[i] = 0.0;
        }

        try {
            fetched_data_left = concatFloat32Arrays(fetched_data_left, emptyArray);
            if (numChannels == 2) {
                fetched_data_right = concatFloat32Arrays(fetched_data_right, emptyArray);
            }
        } catch (ignored) {}
    }

    pcm_buffer_in_use = false;

    if (!stopped && !end_of_song_reached) {
        // lets load more data (decode more audio from the WavPack file)
        if (sample_rate <= 64000) {
            // Standard to medium high samplerate
            if (fetched_data_left.length > min_sample_duration * sample_rate * 2 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval * 4);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 4 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval * 6);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 6 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval * 8);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 8 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval * 10);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 10 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval * 12);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 12 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval * 14);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 14 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval * 16);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 16 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval * 18);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 18 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval * 20);
            } else {
                setTimeout(periodicFetch, fetching_interval);
            }
        } else {
            // high samplerate
            //if (fetched_data_left.length > min_sample_duration * sample_rate) {
            //    fetching_interval = 5;
            //}
            if (fetched_data_left.length > min_sample_duration * sample_rate * 2 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 4 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2 + 4);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 6 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2 + 4 + 6);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 8 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2 + 4 + 6 + 8);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 10 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2 + 4 + 6 + 8 + 10);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 12 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2 + 4 + 6 + 8 + 10 + 12);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 14 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2 + 4 + 6 + 8 + 10 + 12 + 14);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 16 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2 + 4 + 6 + 8 + 10 + 12 + 14 + 16);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 18 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2 + 4 + 6 + 8 + 10 + 12 + 14 + 16 + 18);
            } else if (fetched_data_left.length > min_sample_duration * sample_rate * 20 && decodedamount != 0) {
                setTimeout(periodicFetch, fetching_interval + 2 + 4 + 6 + 8 + 10 + 12 + 14 + 16 + 18 + 20);
            } else {
                setTimeout(periodicFetch, fetching_interval);
            }
        }
    }

    // if we are not actively reading and have fetched enough
    if (!is_reading && fetched_data_left.length >= min_sample_size) {
        readingLoop(); // start reading
        return;
    }

    // Start playing when decoded all but wait very long time...
    //if (end_of_song_reached) {
    //    console.log(buffer.duration);
    //    try {
    //    sourceNode.buffer = buffer;
    //    duration = sourceNode.buffer.duration;

    //    if (sourceNode.start) {
    //        sourceNode.start(0);
    //        startTime = audioContext.currentTime;
    //        updateTime(false);
    //    } else if (sourceNode.noteOn) {
    //        sourceNode.noteOn(0);
    //        startTime = audioContext.currentTime;
    //        updateTime(false);
    //        isPlay.set(true);
    //    }
    //    }
    //    catch (ignored) {}
    //}
}

const readingLoop = () => {
    'use strict';
    if (stopped || fetched_data_left.length < min_sample_size) {
        //is_reading = false;
        if (end_of_song_reached) {
            postMessage(null);
        }
        return;
    }

    addBufferToAudioContext();
};

const addBufferToAudioContext = () => {
    'use strict';
    // let the world know we are actively reading
    is_reading = true;

    while (pcm_buffer_in_use) {
        // wait, this shouldn't be called, but if we're adding more data to the PCM buffer, don't want to overwrite it
        console.log('-');
    }

    pcm_buffer_in_use = true;

    // create a new AudioBuffer
    //const aud_buf = new AudioContext().createBuffer(numChannels, fetched_data_left.length, sample_rate);
    // copy our fetched data to its first channel
    //aud_buf.copyToChannel(fetched_data_left, 0);
    //if (numChannels == 2) {
    //    aud_buf.copyToChannel(fetched_data_right, 1);
    //}
    // the actual player
    //try {
    postMessage({
        L: fetched_data_left,
        R: fetched_data_right
    }, [fetched_data_left.buffer, fetched_data_right.buffer]);
    //} catch (e) {
    //    postMessage({
    //        L: fetched_data_left.slice(),
    //        R: fetched_data_right.slice()
    //    });
    //}
    // clear the buffered data
    fetched_data_left = new Float32Array(0);
    fetched_data_right = new Float32Array(0);

    // Append decoded audio buffer/data for all
    //if (buffer === null) {
    //    buffer = aud_buf;
    //} else {
    //    buffer = appendBuffer(buffer, aud_buf);
    //}

    pcm_buffer_in_use = false;
    //setTimeout(readingLoop, 0);
    if (end_of_song_reached) {
        postMessage(null);
    }
    is_reading = false;
};

self.onmessage = function(event) {
    'use strict';
    if (event.data === 'onended') {
        readingLoop();
        return;
    }

    if (event.data === 'BYTES_PER_ELEMENT') {
        try {
            postMessage({
                BYTES_PER_ELEMENT: Module.HEAP32.BYTES_PER_ELEMENT
            });
        } catch (e) {
            postMessage({
                BYTES_PER_ELEMENT: 0
            });
        }
        return;
    }

    //if (event.data === 'free') {
    //    if (arrayPointer) {
    //        Module._free(arrayPointer);
    //    }
    //    FS.unlink('wavpack.wv');
    //    return;
    //}

    //if (arrayPointer) {
    //    Module._free(arrayPointer);
    //}
    //arrayPointer = undefined;
    play(event.data);
};