// Errors that end the CLI with a message on stderr and a given exit code.
// Thrown from anywhere below main(); only main() calls process.exit.
export class CliError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
    this.name = new.target.name;
  }
}

// Bad arguments (exit 2).
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
  }
}

// git failed or the repository can't be read (exit 1).
export class GitError extends CliError {
  constructor(message: string) {
    super(message, 1);
  }
}

// The repository exists but has no commits yet. Fatal for a single repo,
// merely "no activity" when scanning.
export class EmptyRepoError extends GitError {}

// Help or version was printed; exit cleanly without a message.
export class ExitRequest extends CliError {
  constructor() {
    super('', 0);
  }
}
