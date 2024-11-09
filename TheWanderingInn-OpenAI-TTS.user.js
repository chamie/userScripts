// ==UserScript==
// @name         TWI OpenAI TTS
// @namespace    http://tampermonkey.net/
// @version      2024-11-06
// @description  Uses OpenAI's TTS to read the book.
// @author       You
// @match        https://wanderinginn.com/*
// @match        https://author.today/reader/*
// @icon         https://i0.wp.com/wanderinginn.com/wp-content/uploads/2016/11/erin.png
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

/**
 * @typedef {Object} Paragraph
 * @property {HTMLParagraphElement[]} elements
 * @property {Promise<ArrayBuffer>} audio
 * @property {string} text
 */

const PARAGRAPHS_SELECTOR = ".entry-content p";
let NARRATION_VOICE = await GM.getValue("voice", "nova");
let NARRATION_SPEED = parseFloat(await GM.getValue("speed", 1.2));
let OPENAI_TOKEN = await GM.getValue("OpenAI token", null);
let GOOGLE_CLOUD_TOKEN = await GM.getValue("GoogleCloud token", null);
let USE_GOOGLE = await GM.getValue("use Google", false);

const siteIdentities = {
    twi: {
        controlsParentSelector: "body",
        paragraphsSelector: ".entry-content p",
        controlsContainerClass: "fixed"
    },
    authorToday: {
        controlsParentSelector: "nav",
        paragraphsSelector: "#text-container p",
        controlsContainerClass: "fixed"
    },
}

/**
 * @type {keyof siteIdentities}
 */
const site = "twi";

const siteDefs = siteIdentities[site];

const GoogleVoices = [
    {
        "name": "en-US-Casual-K",
        "gender": "MALE",
    },
    {
        "name": "en-US-Journey-D",
        "gender": "MALE",
    },
    {
        "name": "en-US-Journey-F",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Journey-O",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Neural2-A",
        "gender": "MALE",
    },
    {
        "name": "en-US-Neural2-C",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Neural2-D",
        "gender": "MALE",
    },
    {
        "name": "en-US-Neural2-E",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Neural2-F",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Neural2-G",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Neural2-H",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Neural2-I",
        "gender": "MALE",
    },
    {
        "name": "en-US-Neural2-J",
        "gender": "MALE",
    },
    {
        "name": "en-US-News-K",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-News-L",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-News-N",
        "gender": "MALE",
    },
    {
        "name": "en-US-Polyglot-1",
        "gender": "MALE",
    },
    {
        "name": "en-US-Standard-A",
        "gender": "MALE",
    },
    {
        "name": "en-US-Standard-B",
        "gender": "MALE",
    },
    {
        "name": "en-US-Standard-C",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Standard-D",
        "gender": "MALE",
    },
    {
        "name": "en-US-Standard-E",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Standard-F",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Standard-G",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Standard-H",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Standard-I",
        "gender": "MALE",
    },
    {
        "name": "en-US-Standard-J",
        "gender": "MALE",
    },
    {
        "name": "en-US-Studio-O",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Studio-Q",
        "gender": "MALE",
    },
    {
        "name": "en-US-Wavenet-A",
        "gender": "MALE",
    },
    {
        "name": "en-US-Wavenet-B",
        "gender": "MALE",
    },
    {
        "name": "en-US-Wavenet-C",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Wavenet-D",
        "gender": "MALE",
    },
    {
        "name": "en-US-Wavenet-E",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Wavenet-F",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Wavenet-G",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Wavenet-H",
        "gender": "FEMALE",
    },
    {
        "name": "en-US-Wavenet-I",
        "gender": "MALE",
    },
    {
        "name": "en-US-Wavenet-J",
        "gender": "MALE",
    }
];

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
        .tts-controls-container.fixed {
            position: fixed;
            margin: 0;
            background: rgba(.8,.8,.8,.3);
        }
        .tts-controls-container {
            float: left;
            height: 32px;
            margin: 0 20px;
            padding: 0;
            border: none;
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: space-around;
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
            background: rgba(0,0,0,.65);
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
        .tts-narrated-part-highlighter {
            position: absolute;
            visibility: hidden;
            width: 4px;
            box-shadow: 0 0 5px black;
        }
        .tts-narrated-part-highlighter--progress {
            background: salmon;
            height: 0%;
        }
        .tts-controls-container input.option-switch {
            display: none;
        }
        .tts-controls-container input:checked+.options-container .for-checked,
        .tts-controls-container input:not(:checked)+.options-container .for-unchecked {
            display: initial;
        }

        .tts-controls-container input:not(:checked)+.options-container .for-checked,
        .tts-controls-container input:checked+.options-container .for-unchecked {
            display: none;
        }
        .tts-controls-container .options-container {
            display: flex;
            flex-direction: column;
        }
        .tts-controls-container .options-container label {
            cursor: pointer;
            text-decoration: underline;
        }
        .tts-controls-container .options-container .token-input {
            color: lightgray;
            transition: all .5s;
            background: lightgray;
        }
        .tts-controls-container .options-container .token-input:hover {
            color: black;
            background: white;
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
    controlsContainer.className = "tts-controls-container " + siteDefs.controlsContainerClass;
    controlsContainer.innerHTML = loader;
    controlsContainer.title = "Text-to-Speech controls, you can also start narration by pressing Shift+R on the keyboard";
    return controlsContainer;
}

const createSettingsButton = () => {
    const settingsButton = document.createElement("span");
    const openAIVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    settingsButton.innerHTML = `
    <label class="menu-button"><input type="checkbox" /><span>⚙</span>
    <span>
        <input ${USE_GOOGLE ? "checked" : ""} type="checkbox" class="option-switch" id="tts-engine-switch" name="use-google" />
        <div class="options-container">
        Engine: 
        <label class="for-unchecked" title="Click to change" for="tts-engine-switch">OpenAI</label>
        <label class="for-checked" title="Click to change" for="tts-engine-switch">GoogleCloud</label>
        <div class="for-unchecked">
            Narration voice:
            <select name="open-ai-voice">
                ${openAIVoices.map(v => `<option ${v === NARRATION_VOICE ? "selected" : ""} value="${v}">${v}</option>`).join("")}
            </select><br>
            OpenAI access token:
            <input placeholder="Input your OpenAI access token here" name="token" />
        </div>
        <div class="for-checked">
            Narration voice:
            <select name="google-cloud-voice">
                ${GoogleVoices.map(v => `<option ${v.name === NARRATION_VOICE ? "selected" : ""} value="${v.name}">${v.name} (${v.gender})</option>`).join("")}
            </select><br>
            GCloud access token:
            <input class="token-input" placeholder="Input your GoogleCloud access token here" name="gcloud-token" />
        </div>
        </div>
    </span>
    </label>`;
    /** @type {HTMLInputElement} */
    const useGoogleCheckbox = settingsButton.querySelector("input[name=use-google]");
    useGoogleCheckbox.onchange = () => { USE_GOOGLE = useGoogleCheckbox.checked; GM.setValue("use Google", USE_GOOGLE); }
    const voiceSelect = settingsButton.querySelector("select[name=open-ai-voice]");
    voiceSelect.onchange = () => { NARRATION_VOICE = voiceSelect.value; GM.setValue("voice", NARRATION_VOICE); };
    const tokenInput = settingsButton.querySelector("input[name=token]");
    tokenInput.value = OPENAI_TOKEN || "";
    tokenInput.onchange = () => {
        OPENAI_TOKEN = tokenInput.value;
        GM.setValue("OpenAI token", OPENAI_TOKEN);
    }
    const googleTokenInput = settingsButton.querySelector("input[name=gcloud-token]");
    googleTokenInput.value = GOOGLE_CLOUD_TOKEN || "";
    googleTokenInput.onchange = () => {
        GOOGLE_CLOUD_TOKEN = googleTokenInput.value;
        GM.setValue("GoogleCloud token", GOOGLE_CLOUD_TOKEN);
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

const createNarrationHighlighter = () => {
    const element = document.createElement("div");
    element.className = "tts-narrated-part-highlighter";
    element.innerHTML = `<div class="tts-narrated-part-highlighter--progress"></div>`;
    const progressBar = element.querySelector('.tts-narrated-part-highlighter--progress');

    return {
        element,
        /** @param {number} percentage percentage to set the progress to */
        setPercentage: (percentage) => { progressBar.style.height = `${percentage * 100}%`; },
        /** Place the highlighter to the left of a column of elements and stretch it to their combined height
         * @param {HTMLElement[]} elements Elements to abut (place next to and stretch) */
        abut: (elements) => {
            const top = elements[0].offsetTop;
            const lastElement = elements.at(-1);
            const bottom = lastElement.offsetTop + lastElement.offsetHeight;
            const height = bottom - top;
            const left = lastElement.offsetLeft - 15;

            element.style.top = `${top}px`;
            element.style.height = `${height}px`;
            element.style.left = `${left}px`;
            element.style.visibility = "visible";
        },
        hide: () => {
            element.style.visibility = "hidden";
        }
    };
}

const extractElementText = (element) => {
    const clone = element.cloneNode(true);
    [...clone.getElementsByTagName("em")].forEach(x => x.outerHTML = USE_GOOGLE ? `'${x.innerText.trim()}'` : `*${x.innerText.trim()}*`);
    [...clone.children].forEach(x => x.outerHTML = x.innerText);
    let result = clone.innerText.trim();
    return USE_GOOGLE ? result : result.replace(/\[(.*?)\]/g, "_$1_");
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
    audio.addEventListener("timeupdate", () => {
        highlighter.setPercentage(audio.currentTime / audio.duration)
    });
    $(siteDefs.controlsParentSelector).append(audio);

    // Add highlighter
    const highlighter = createNarrationHighlighter();
    $(siteDefs.paragraphsSelector).parentElement.parentElement.append(highlighter.element);


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
            highlighter.hide();
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

    $(siteDefs.controlsParentSelector).append(controlsContainer);

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

    const toSpeechGoogle = async (text) => {
        const body = {
            input: {
                text
            },
            voice: {
                languageCode: "en-US",
                name: "en-US-Journey-D",
            },
            audioConfig: {
                audioEncoding: "OGG_OPUS"
            }
        }
        const request = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_CLOUD_TOKEN}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body),
        });

        const response = await request.json();

        return response.audioContent;
    }

    /**
     * Plays the audio data.
     * @param audioData {Response | string} Response data (if isBlob) or base64 of the file
     */
    const playAudio = (audioData, isBlob) => {
        if(isBlob) {
        const blob = new Blob([audioData], { type: "audio/mpeg" });
        audio.src = URL.createObjectURL(blob);
        } else {
            audio.src = `data:audio/ogg;base64,${audioData}`;
        }
        audio.playbackRate = NARRATION_SPEED;
        audio.play();

        //We may show the player:
        //audio.style.display = "block";
    }

    const startReading = async () => {
        // aggregate the paragraphs text into the array
        paragraphs = paragraphs.length
            ? paragraphs
            : $$(siteDefs.paragraphsSelector).map(p => ({
                firstElement: p,
                text: extractElementText(p),
            })).filter(x => x.text).map(x => ({ ...x, elements: [x.firstElement] }));

        // join short (under 200 chars) paragraphs with prev one, if that one is less than 1000
        let skippedCounter = 0;
        paragraphs.forEach((paragraph, idx) => {
            if (idx < 1) {
                return;
            }
            const prevParagraph = paragraphs[idx - 1 - skippedCounter];
            if (prevParagraph && paragraph.text.length < 200 && idx > 0 && prevParagraph.text.length < 1000) {
                skippedCounter++;
                prevParagraph.text += "\n" + paragraph.text;
                prevParagraph.elements.push(paragraph.firstElement);
                paragraph.text = null;
            } else {
                skippedCounter = 0;
            }
        });

        paragraphs = paragraphs.filter(p => p.text);


        const firstVisibleParagraphIdx = paragraphs.findIndex(paragraph => isElementInViewport(paragraph.firstElement));

        let currentParagraphIdx = firstVisibleParagraphIdx;

        // const getBufferedAudioLengthInCharacters = () =>
        //     paragraphs.slice(currentParagraphIdx)
        //         .filter(x => x.audio)
        //         .reduce((acc, p) => acc += p.text.length, 0);

        const getBufferedAudioLengthInParagraphs = () =>
            paragraphs.slice(currentParagraphIdx)
                .filter(x => x.audio || x.googleAudio).length;

        const topUpAudioBuffer = () => {
            while (currentParagraphIdx < paragraphs.length - 1 && getBufferedAudioLengthInParagraphs() < 3) {
                const paragraph = paragraphs.slice(currentParagraphIdx).find(x => !x.audio && !x.googleAudio);
                if (!paragraph) {
                    break;
                }
                if (USE_GOOGLE) {
                    paragraph.googleAudio = toSpeechGoogle(paragraph.text);
                } else {
                    paragraph.audio = toSpeech(paragraph.text);
                }
            }
        }

        const playNext = async () => {
            const paragraph = paragraphs[currentParagraphIdx];

            if (!paragraph) {
                actions.stop();
                return;
            }

            topUpAudioBuffer();

            highlighter.abut(paragraph.elements);
            highlighter.setPercentage(0);

            const isBlob = !!paragraph.audio;

            const audio = isBlob
                ? await paragraph.audio
                : await paragraph.googleAudio;

            if (audio === undefined) {
                console.error(`No audio request sent for paragraph`, paragraph);
                return;
            }
            
            playAudio(audio, isBlob);

            paragraph.firstElement.scrollIntoView();

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