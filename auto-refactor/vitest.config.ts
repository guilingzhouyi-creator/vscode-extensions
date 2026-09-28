import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/unit/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json'],
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.d.ts',
                'src/daemon/**',
                'src/cli/**',
                '**/.auto-refactor-cache/**',
            ],
            // Thresholds are set just below the measured value for the modules that carry
            // behavioural assertions, so an ordinary edit cannot silently reduce coverage.
            // They are deliberately not global: `src/core/scoring/**` holds twenty modules
            // that no unit test exercises yet, so a whole-tree floor would be unreachable
            // and would only teach everyone to ignore the number. Raising these is the
            // follow-up work, and the measurement is what makes it trackable.
            thresholds: {
                'src/core/scoring/scorer-formulas.ts': {
                    statements: 55,
                    branches: 55,
                    functions: 40,
                    lines: 55,
                },
                'src/core/cfg/cfg-builder.ts': {
                    statements: 78,
                    branches: 85,
                    functions: 74,
                    lines: 80,
                },
                'src/core/cfg/def-use-chain.ts': {
                    statements: 88,
                    branches: 55,
                    functions: 83,
                    lines: 86,
                },
            },
        },
        globals: false,
        testTimeout: 30_000,
    },
});
