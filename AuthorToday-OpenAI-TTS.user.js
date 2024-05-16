// ==UserScript==
// @name         Author.Today OpenAI TTS
// @namespace    https://github.com/chamie
// @version      2024-05-15
// @description  Uses OpenAI's TTS to read the book.
// @author       Chamie
// @match        https://author.today/reader/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=author.today
// @grant        none
// ==/UserScript==

//Striped border style:
/*
`
border: 10px solid;
border-image-outset: 0;
border-image-repeat: stretch;
border-image-slice: 100%;
border-image-source: none;
border-image-width: 1;
border-image: repeating-linear-gradient(45deg, white,white, black, black, white 20px) 9;
`
*/

(function () {
    const openAIToken = "INSERT-YOUR-API-KEY-HERE";

    
    const loader = `
        <svg viewBox="0 0 10 5" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="10" style="fill: #dbf7ff; opacity: 0.7">
                <animate attributeName="x" values="-100%; 100%" dur="1s" repeatCount="indefinite" />
            </rect>
        </svg>
    `.replaceAll(/\n/g, "");

    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];

    /** @type {"idle"|"playing"|"paused"} */
    let currentAction = "idle";

    const audio = new Audio();
    audio.controls = true;
    audio.className = "tts-audio-player";
    $("nav").append(audio);

    // Adding component CSS styles
    const style = document.createElement("style");
    style.innerHTML = `
        p.beingNarrated {
            box-shadow: 2px 2px 3px black, -2px -2px 3px white;
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
    `;
    document.body.append(style);

    // Adding controls
    const controlsContainer = document.createElement("div");
    controlsContainer.className = "tts-controls-container";
    controlsContainer.innerHTML = loader;
    controlsContainer.title = "Text-to-Speech controls, you can also start narration by pressing Shift+R on the keyboard";

    const setAction = actionName => {
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
            if (currentAction === "paused") {
                audio.play();
            } else {
                startReading();
            }
            setAction("playing");
        },
        stop: () => {
            setAction("idle");
            audio.src = undefined;
            $$("p.beingNarrated").forEach(p => p.classList.remove("beingNarrated"));
        },
        pause: () => {
            setAction("paused");
            audio.pause();
        }
    }

    const buttons = [
        ["play", "⏵", actions.play],
        ["pause", "⏸", actions.pause],
        ["stop", "⏹", actions.stop],
    ].map(btn => {
        const [className, text, handler] = btn;
        const button = document.createElement("button");
        button.innerHTML = text;
        button.className = className;
        button.onclick = handler;
        return button;
    })
    controlsContainer.append(...buttons);
    $("nav").append(controlsContainer);

    let loadingCounter = 0;

    /**
     * Converts text into speech audio using the OpenAI TTS API
     * @param {string} text Text to convert into audio
     * @returns ArrayBuffer with the content of mp3 audio file
     */
    const fetchAudio = async (text) => {
        setLoading(true);
        loadingCounter++;
        const response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openAIToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "tts-1",
                input: text,
                voice: "onyx",
            })
        });

        loadingCounter--;

        if (!loadingCounter) {
            setLoading(false);
        }

        return response.arrayBuffer();
    }

    /**
     * Plays the audio data.
     * @param data {Response} Response data of the audio file.
     */
    const playAudio = (data) => {
        const blob = new Blob([data], { type: "audio/mpeg" });
        audio.src = URL.createObjectURL(blob);
        audio.playbackRate = 1.2;
        audio.play();

        //We may show the player:
        //audio.style.display = "block";
    }

    const startReading = async () => {

        const readerScrollTop = $("#reader").scrollTop;
        /** @type {HTMLParagraphElement[]} */
        const paragraphs = $$("#text-container p");
        const paragraphTexts = paragraphs.map(p => p.innerText);

        const firstVisibleParagraphIdx = paragraphs.findIndex(x => x.style.border = x.offsetTop - readerScrollTop > 0);

        /** @type {number[]} */
        const paragraphsStash = [];

        /** @type {Map<number, Promise<ArrayBuffer>>} */
        const paragraphAudio = new Map();

        const getStashLength = () =>
            paragraphsStash.reduce((acc, pIdx) => acc += paragraphTexts[pIdx].length, 0);

        let currentParagraphIdx = firstVisibleParagraphIdx;

        const topUpStash = () => {
            while (currentParagraphIdx < paragraphs.length && getStashLength() + paragraphTexts[currentParagraphIdx].length < 4000) {
                paragraphsStash.push(currentParagraphIdx);
                const text = paragraphTexts[currentParagraphIdx];
                if (!paragraphAudio.has(currentParagraphIdx)) {
                    paragraphAudio.set(currentParagraphIdx, fetchAudio(text));
                }
                currentParagraphIdx++;
            }
        }

        const playNext = async () => {
            $$("p.beingNarrated").forEach(p => p.classList.remove("beingNarrated"));

            const idx = paragraphsStash.shift();
            if (idx === undefined) {
                actions.stop();
                return;
            }

            topUpStash();

            const paragraph = paragraphs[idx];
            const audio = await paragraphAudio.get(idx);

            if (audio === undefined) {
                console.error(`No audio request sent for paragraph ${idx}`, paragraph);
                return;
            }

            playAudio(audio);

            paragraph.classList.add("beingNarrated");

            // This comes too high:
            //paragraph.scrollIntoView();

            $("#reader").scrollTop = paragraph.offsetTop;
        }

        audio.addEventListener("ended", playNext);

        topUpStash();
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

})();