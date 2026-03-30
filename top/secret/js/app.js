const PASSCODE = "1234";
const TERMINAL_LINE = "Welcome to our Dallas, Texas SCIF. Make no mistake: this is our most secure facility, despite being under a Buc-ee's. Here, you will coordinate the war effort against our foreign adversaries. Buc-ee up.";

const screens = {
  gate: document.getElementById("gateScreen"),
  terminal: document.getElementById("terminalScreen"),
  command: document.getElementById("commandScreen")
};

const readout = document.getElementById("readout");
const gateHint = document.getElementById("gateHint");
const keypad = document.getElementById("keypad");
const keypadButtons = Array.from(keypad.querySelectorAll(".key"));
const typed = document.getElementById("typed");
const confirmBtn = document.getElementById("confirmBtn");

let game = null;

let entered = "";
let gateLocked = false;
const terminalTyping = {
  active: false,
  cursor: 0,
  timerId: null
};

function showScreen(name) {
  Object.keys(screens).forEach((key) => screens[key].classList.remove("active"));
  screens[name].classList.add("active");
}

function renderReadout() {
  const chars = entered.split("").map(() => "*");
  while (chars.length < 4) chars.push("_");
  readout.textContent = chars.join(" ");
}

function resetGateHint() {
  gateHint.textContent = "Enter passcode with keypad or keyboard";
  gateHint.style.color = "";
}

function failGate() {
  gateHint.textContent = "ACCESS DENIED. Nice try, intern.";
  gateHint.style.color = "#ff7979";
  entered = "";
  renderReadout();
  window.setTimeout(resetGateHint, 1200);
}

function finishTerminalLine() {
  if (terminalTyping.timerId) {
    window.clearTimeout(terminalTyping.timerId);
    terminalTyping.timerId = null;
  }

  terminalTyping.active = false;
  terminalTyping.cursor = TERMINAL_LINE.length;
  typed.textContent = TERMINAL_LINE;
  confirmBtn.style.display = "inline-block";
}

function typeTerminalNextChar() {
  if (!terminalTyping.active) return;

  if (terminalTyping.cursor >= TERMINAL_LINE.length) {
    finishTerminalLine();
    return;
  }

  typed.textContent += TERMINAL_LINE[terminalTyping.cursor++];
  terminalTyping.timerId = window.setTimeout(typeTerminalNextChar, 24 + Math.random() * 36);
}

function runTerminalLine() {
  typed.textContent = "";
  confirmBtn.style.display = "none";
  terminalTyping.active = true;
  terminalTyping.cursor = 0;
  if (terminalTyping.timerId) {
    window.clearTimeout(terminalTyping.timerId);
    terminalTyping.timerId = null;
  }

  typeTerminalNextChar();
}

function submitGate() {
  if (gateLocked) return;

  if (entered === PASSCODE) {
    gateLocked = true;
    showScreen("terminal");
    runTerminalLine();
    return;
  }

  failGate();
}

function handleInputKey(key) {
  if (gateLocked) return;

  if (/^[0-9]$/.test(key)) {
    if (entered.length < 4) {
      entered += key;
      renderReadout();
    }
    if (entered.length === 4) submitGate();
    return;
  }

  if (key === "Backspace") {
    entered = entered.slice(0, -1);
    renderReadout();
    return;
  }

  if (key === "Enter") {
    if (entered.length > 0) submitGate();
    return;
  }

  if (key.toLowerCase() === "c") {
    entered = "";
    renderReadout();
  }
}

function wireKeypad() {
  keypadButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.key || button.textContent;
      if (!key) return;
      handleInputKey(key);
    });
  });
}

wireKeypad();
renderReadout();

window.addEventListener("keydown", (event) => {
  if (screens.terminal.classList.contains("active") && event.code === "Space") {
    event.preventDefault();
    if (terminalTyping.active) finishTerminalLine();
    return;
  }

  if (!screens.gate.classList.contains("active")) return;

  if (
    /^[0-9]$/.test(event.key) ||
    event.key === "Backspace" ||
    event.key === "Enter" ||
    event.key.toLowerCase() === "c"
  ) {
    event.preventDefault();
  }

  handleInputKey(event.key);
});

confirmBtn.addEventListener("click", () => {
  if (!game) {
    if (!window.CommandCenterGame) {
      console.error("Command center module is unavailable.");
      gateHint.textContent = "Command center failed to load. Refresh and retry.";
      gateHint.style.color = "#ff7979";
      return;
    }

    game = new window.CommandCenterGame(screens.command);
  }

  showScreen("command");
  game.start();
});
