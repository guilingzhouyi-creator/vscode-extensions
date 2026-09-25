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
            ],
        },
        globals: false,
        testTimeout: 30_000,
    },
});
