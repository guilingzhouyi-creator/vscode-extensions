const ts = require('typescript');
const path = require('path');
const fs = require('fs');

console.log('[compile-project] Loading tsconfig.json...');
const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
if (!configPath) {
  console.error('tsconfig.json not found');
  process.exit(1);
}

// Remove stale build info to force fresh emit
const tsBuildInfoPath = path.join(process.cwd(), '.tsbuildinfo');
if (fs.existsSync(tsBuildInfoPath)) {
  try {
    fs.unlinkSync(tsBuildInfoPath);
  } catch (_e) {
    // ignore
  }
}

const readConfigFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedCommandLine = ts.parseJsonConfigFileContent(
  readConfigFile.config,
  ts.sys,
  path.dirname(configPath),
);

console.log(
  `[compile-project] Found ${parsedCommandLine.fileNames.length} TypeScript files. Creating compiler program...`,
);
const program = ts.createProgram({
  rootNames: parsedCommandLine.fileNames,
  options: parsedCommandLine.options,
  configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(parsedCommandLine),
});

console.log('[compile-project] Emitting JS and declaration files...');
const emitResult = program.emit();

const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

let errorCount = 0;
for (const diagnostic of allDiagnostics) {
  if (diagnostic.category === ts.DiagnosticCategory.Error) {
    errorCount++;
    if (diagnostic.file) {
      const { line, character } = ts.getLineAndCharacterOfPosition(
        diagnostic.file,
        diagnostic.start,
      );
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      console.error(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
    } else {
      console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    }
  }
}

if (errorCount > 0) {
  console.error(`[compile-project] Compilation failed with ${errorCount} errors.`);
  process.exit(1);
} else {
  console.log('[compile-project] TypeScript compilation successful! 0 errors.');
  process.exit(0);
}
