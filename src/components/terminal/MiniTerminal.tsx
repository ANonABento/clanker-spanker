import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface MiniTerminalProps {
  output: string[];
  className?: string;
}

export function MiniTerminal({ output, className = "" }: MiniTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastOutputLengthRef = useRef(0);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current) return;

    const terminal = new Terminal({
      rows: 4,
      cols: 50,
      fontSize: 10,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#707070",
        cursor: "#707070",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#404040",
      },
      scrollback: 100,
      cursorBlink: false,
      cursorStyle: "bar",
      disableStdin: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);

    // Fit terminal to container
    try {
      fitAddon.fit();
    } catch {
      // Ignore fit errors on initial render
    }

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    lastOutputLengthRef.current = 0;

    // Write initial output
    output.forEach((line) => {
      terminal.writeln(line);
    });
    lastOutputLengthRef.current = output.length;

    return () => {
      terminal.dispose();
    };
  }, []);

  // Write new output lines
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    // Only write new lines
    const newLines = output.slice(lastOutputLengthRef.current);
    newLines.forEach((line) => {
      terminal.writeln(line);
    });
    lastOutputLengthRef.current = output.length;
  }, [output]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore fit errors
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={terminalRef}
        className="overflow-hidden rounded border-l-2 border-l-[#8b5cf6]/30 border border-[#1a1a1a] h-full"
      />
      {/* Fade overlay at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-[#0a0a0a] to-transparent pointer-events-none rounded-b" />
    </div>
  );
}
