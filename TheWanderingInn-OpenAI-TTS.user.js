// ==UserScript==
// @name         TWI OpenAI TTS
// @namespace    http://tampermonkey.net/
// @version      2024-10-11
// @description  Uses OpenAI's TTS to read the book.
// @author       You
// @match        https://wanderinginn.com/*
// @icon         https://i0.wp.com/wanderinginn.com/wp-content/uploads/2016/11/erin.png
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

/**
 * @typedef {Object} Paragraph
 * @property {HTMLParagraphElement} element
 * @property {Promise<ArrayBuffer>} audio
 * @property {string} text
 */

const PARAGRAPHS_SELECTOR = ".entry-content p";
let NARRATION_VOICE = await GM.getValue("voice", "nova");
let NARRATION_SPEED = parseFloat(await GM.getValue("speed", 1.2));
let OPENAI_TOKEN = await GM.getValue("OpenAI token", null);

const isElementInViewport = (el) => {
    var rect = el.getBoundingClientRect();

    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && /* or $(window).height() */
        rect.right <= (window.innerWidth || document.documentElement.clientWidth) /* or $(window).width() */
    );
}

const addStyles = () => {

    // Adding component CSS styles
    const style = document.createElement("style");
    style.innerHTML = `
        p.beingNarrated {
            box-shadow: 0 0 10px black, inset 0 0 30px 10px rgba(255,255,255,0.3);
            border-radius: 5px;
            padding: 5px;
        }
        .tts-controls-container {
            position: fixed;
            height: 32px;
            margin: 0;
            padding: 0;
            border: none;
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: space-around;
            background: rgba(.8,.8,.8,.3);
        }
        .tts-controls-container button {
            display: none;
            opacity: .7;
            margin: 0 5px;
        }
        .tts-controls-container.playing .pause,
        .tts-controls-container.playing .stop,
        .tts-controls-container.paused .play,
        .tts-controls-container.paused .stop,
        .tts-controls-container.idle .play {
            display: block;
        }

        .tts-controls-container .menu-button > input,
        .tts-controls-container .menu-button input + span + span{
            display: none;
        }
        .tts-controls-container .menu-button input:checked + span + span {
            display: block;
            position: absolute;
            padding: 5px;
            box-shadow: 0 0 10px black, inset 0 0 30px 10px rgba(255,255,255,0.3);
            border-radius: 5px;
            padding: 5px;
        }

        .tts-audio-player {
            float: left;
            height: 32px;
            margin: 0 20px;
            display: none;
        }
        .tts-controls-container svg {
            margin-right: -64px;
            width: 64px;
            display: none;
        }
        .tts-controls-container.isLoading svg {
            display: block;
        }
        .tts-playback-rate-controls {
            display: flex;
            flex-direction: row;
        }
        .tts-playback-rate-controls span {
            padding: 5px;
        }
    `;
    document.body.append(style);
}

const loader = `
<svg viewBox="0 0 10 5" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="10" style="fill: #dbf7ff; opacity: 0.7">
        <animate attributeName="x" values="-100%; 100%" dur="1s" repeatCount="indefinite" />
    </rect>
</svg>
`.replaceAll(/\n/g, "");

const createControlsContainer = () => {
    const controlsContainer = document.createElement("div");
    controlsContainer.className = "tts-controls-container";
    controlsContainer.innerHTML = loader;
    controlsContainer.title = "Text-to-Speech controls, you can also start narration by pressing Shift+R on the keyboard";
    return controlsContainer;
}

const createSettingsButton = () => {
    const settingsButton = document.createElement("span");
    const voices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    settingsButton.innerHTML = `
    <label class="menu-button"><input type="checkbox" ${OPENAI_TOKEN ? "" : "checked"} /><span>⚙</span>
    <span>Narration voice:
        <select>
            ${voices.map(v => `<option ${v === NARRATION_VOICE ? "selected" : ""} value="${v}">${v}</option>`).join("")}
        </select><br>
        OpenAI access token:
        <input placeholder="Input your OpenAI access token here" name="token">
    </span>
    </label>`;
    //$(".show-settings-btn").style = `position: fixed; top: 0; right: 0;`;
    const voiceSelect = settingsButton.getElementsByTagName("select")[0];
    voiceSelect.onchange = () => { NARRATION_VOICE = voiceSelect.value; GM.setValue("voice", NARRATION_VOICE); };
    const tokenInput = settingsButton.querySelector("input[name=token]");
    tokenInput.value = OPENAI_TOKEN || "";
    tokenInput.onchange = () => {
        OPENAI_TOKEN = tokenInput.value;
        GM.setValue("OpenAI token", OPENAI_TOKEN);
    }
    return settingsButton;
}

const createActionButton = ([className, text, handler]) => {
    const button = document.createElement("button");
    button.innerHTML = text;
    button.className = className;
    button.onclick = handler;
    return button;
}

const createSpeedControls = (audio) => {
    const speedControls = document.createElement("div");
    speedControls.className = "tts-playback-rate-controls";
    speedControls.title = `Narration speed: ${NARRATION_SPEED}`;

    const speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = 0.25;
    speedSlider.max = 2.5;
    speedSlider.step = .05;
    speedSlider.value = NARRATION_SPEED;
    const speedValue = document.createElement("span");
    speedSlider.oninput = () => {
        NARRATION_SPEED = speedSlider.value;
        GM.setValue("speed", NARRATION_SPEED);
        audio.playbackRate = NARRATION_SPEED;
        speedControls.title = `Narration speed: ${NARRATION_SPEED}`;;
        speedValue.innerHTML = NARRATION_SPEED;
    }

    speedControls.append(speedSlider, speedValue);

    return speedControls;
}

const extractElementText = (element) => {
    const clone = element.cloneNode(true);
    [...clone.getElementsByTagName("em")].forEach(x => x.outerHTML = `*${x.innerText.trim()}*`);
    [...clone.children].forEach(x => x.outerHTML = x.innerText);
    return clone.innerText.replace(/\[(.*?)\]/g, "_$1_");
}

(function () {
    /** @type {Paragraph[]} */
    let paragraphs = [];

    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];

    /** @type {"idle"|"playing"|"paused"} */
    let currentAction = "idle";

    const audio = new Audio();
    audio.controls = true;
    audio.className = "tts-audio-player";
    $("#nav-left").append(audio);

    // Adding controls
    const controlsContainer = createControlsContainer();

    const setCurrentAction = actionName => {
        controlsContainer.classList.remove("paused", "playing", "idle");
        controlsContainer.classList.add(actionName);
        currentAction = actionName;
    }

    const setLoading = isLoading => {
        if (isLoading) {
            controlsContainer.classList.add("isLoading");
        } else {
            controlsContainer.classList.remove("isLoading");
        }
    }

    const actions = {
        play: () => {
            if (currentAction === "playing") {
                return;
            }

            if (currentAction === "paused") {
                audio.play();
            } else {
                startReading();
            }
            setCurrentAction("playing");
        },
        stop: () => {
            setCurrentAction("idle");
            audio.src = undefined;
            $$("p.beingNarrated").forEach(p => p.classList.remove("beingNarrated"));
        },
        pause: () => {
            setCurrentAction("paused");
            audio.pause();
        }
    }

    const buttons = [
        ["play", "▶️", actions.play],
        ["pause", "⏸", actions.pause],
        ["stop", "⏹", actions.stop],
    ].map(createActionButton);

    controlsContainer.append(...buttons);

    controlsContainer.append(createSettingsButton());

    controlsContainer.append(createSpeedControls(audio));

    $("body").append(controlsContainer);

    let loadingCounter = 0;

    /**
     * Converts text into speech audio using the OpenAI TTS API
     * @param {string} text Text to convert into audio
     * @returns {Promise<ArrayBuffer>} ArrayBuffer with the content of mp3 audio file
     */
    const toSpeech = async (text) => {
        setLoading(true);
        loadingCounter++;

        try {
            const response = await fetch("https://api.openai.com/v1/audio/speech", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENAI_TOKEN}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "tts-1",
                    input: text,
                    voice: NARRATION_VOICE,
                })
            });

            loadingCounter--;

            if (!loadingCounter) {
                setLoading(false);
            }

            return response.arrayBuffer();
        }
        catch (e) {
            loadingCounter--;
            console.error(e);
            return null;
        }
    }

    /**
     * Plays the audio data.
     * @param audioData {Response} Response data of the audio file.
     */
    const playAudio = (audioData) => {
        const blob = new Blob([audioData], { type: "audio/mpeg" });
        audio.src = URL.createObjectURL(blob);
        audio.playbackRate = NARRATION_SPEED;
        audio.play();

        //We may show the player:
        //audio.style.display = "block";
    }

    const startReading = async () => {
        // aggregate the paragraphs text into the array
        paragraphs = paragraphs.length
            ? paragraphs
            : $$(PARAGRAPHS_SELECTOR).map(p => ({
                element: p,
                text: extractElementText(p),
            })).filter(x => x.text.trim());

        // join short (under 100 chars) paragraphs with prev one, if that is not over 1000 chars
        paragraphs.forEach((paragraph, idx) => {
            if (idx < 1) {
                return;
            }
            const prevParagraph = paragraphs[idx - 1];
            if (paragraph.text.length < 100 && idx > 0 && prevParagraph.text.length < 1000) {
                prevParagraph.text += paragraph.text;
                paragraph.text = null;
            }
        });

        paragraphs = paragraphs.filter(paragraph => paragraph.text);

        const firstVisibleParagraphIdx = paragraphs.findIndex(paragraph => isElementInViewport(paragraph.element));

        let currentParagraphIdx = firstVisibleParagraphIdx;

        const getBufferedAudioLengthInCharacters = () =>
            paragraphs.slice(currentParagraphIdx)
                .filter(x => x.audio)
                .reduce((acc, p) => acc += p.text.length, 0);

        const topUpAudioBuffer = () => {
            while (currentParagraphIdx < paragraphs.length - 1 && getBufferedAudioLengthInCharacters() < 2000) {
                const paragraph = paragraphs.slice(currentParagraphIdx).find(x => !x.audio);
                if (!paragraph) {
                    break;
                }
                paragraph.audio = toSpeech(paragraph.text);
            }
        }

        const playNext = async () => {
            $$("p.beingNarrated").forEach(p => p.classList.remove("beingNarrated"));

            const paragraph = paragraphs[currentParagraphIdx];

            if (!paragraph) {
                actions.stop();
                return;
            }

            topUpAudioBuffer();

            paragraph.element.classList.add("beingNarrated");

            const audio = await paragraph.audio;

            if (audio === undefined) {
                console.error(`No audio request sent for paragraph`, paragraph);
                return;
            }

            playAudio(audio);

            paragraph.element.scrollIntoView();

            document.scrollingElement.scrollTop = document.scrollingElement.scrollTop - 100;

            currentParagraphIdx++;
        }

        audio.addEventListener("ended", playNext);

        topUpAudioBuffer();

        playNext();
    }

    document.addEventListener("keyup", event => {
        if (event.key === "R") {
            if (currentAction === "idle") {
                actions.play();
            } else {
                actions.pause();
            }
        }
    });

    actions.stop();

    addStyles();
})();