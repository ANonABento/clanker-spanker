import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface FullTerminalProps {
  output: string[];
  onInput?: (data: string) => void;
  className?: string;
}

// Check if terminal is scrolled to bottom
function isAtBottom(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  // viewportY = line at top of viewport, baseY = line at top when scrolled to bottom
  // When at bottom: viewportY >= baseY
  return buffer.viewportY >= buffer.baseY;
}

export function FullTerminal({ output, onInput, className = "" }: FullTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastOutputLengthRef = useRef(0);
  const inputBufferRef = useRef("");
  const userScrolledRef = useRef(false);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current) return;

    const terminal = new Terminal({
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#a0a0a0",
        cursor: "#a0a0a0",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#404040",
        black: "#0a0a0a",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e5e5e5",
        brightBlack: "#505050",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#fde047",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      scrollback: 1000,
      cursorBlink: true,
      cursorStyle: "bar",
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);

    // Fit terminal to container
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors on initial render
      }
    }, 0);

    // Handle user input
    terminal.onData((data) => {
      if (data === "\r") {
        // Enter pressed - send input
        if (inputBufferRef.current && onInput) {
          onInput(inputBufferRef.current);
        }
        terminal.write("\r\n");
        inputBufferRef.current = "";
      } else if (data === "\x7f") {
        // Backspace
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          terminal.write("\b \b");
        }
      } else if (data >= " ") {
        // Regular character
        inputBufferRef.current += data;
        terminal.write(data);
      }
    });

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    lastOutputLengthRef.current = 0;
    userScrolledRef.current = false;

    // Track when user scrolls away from bottom
    terminal.onScroll(() => {
      userScrolledRef.current = !isAtBottom(terminal);
    });

    // Write initial output
    output.forEach((line) => {
      terminal.writeln(line);
    });
    lastOutputLengthRef.current = output.length;

    // Focus terminal
    terminal.focus();

    return () => {
      terminal.dispose();
    };
  }, [onInput]);

  // Write new output lines (preserving user scroll position)
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    // Check if user was at bottom before writing
    const wasAtBottom = isAtBottom(terminal);

    // Only write new lines
    const newLines = output.slice(lastOutputLengthRef.current);
    newLines.forEach((line) => {
      terminal.writeln(line);
    });
    lastOutputLengthRef.current = output.length;

    // Only auto-scroll if user was at bottom (respect their scroll position)
    if (wasAtBottom && newLines.length > 0) {
      terminal.scrollToBottom();
    }
  }, [output]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // Ignore fit errors
        }
      }, 0);
    };

    window.addEventListener("resize", handleResize);

    // ResizeObserver for container size changes
    const observer = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      observer.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, []);

  const handleClick = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  return (
    <div
      ref={terminalRef}
      onClick={handleClick}
      className={`overflow-hidden p-3 ${className}`}
    />
  );
}
