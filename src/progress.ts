import process from 'node:process';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Progress {
  update: (text: string) => void;
  stop: () => void;
}

// Animated spinner on stderr while slow work runs. A no-op when stderr is not
// a TTY (piped or redirected), so it never pollutes captured output.
export function startProgress(text: string, stream: NodeJS.WriteStream = process.stderr): Progress {
  if (!stream.isTTY)
    return { update: () => {}, stop: () => {} };

  let frame = 0;
  let label = text;
  // \r returns the cursor to column 0; ESC[2K clears the entire line.
  const draw = () => stream.write(`\r\x1B[2K${FRAMES[frame++ % FRAMES.length]} ${label}`);
  draw();
  const timer = setInterval(draw, 80);
  timer.unref();

  let stopped = false;
  return {
    update: (next) => {
      label = next;
    },
    stop: () => {
      if (stopped)
        return;
      stopped = true;
      clearInterval(timer);
      stream.write('\r\x1B[2K');
    },
  };
}
