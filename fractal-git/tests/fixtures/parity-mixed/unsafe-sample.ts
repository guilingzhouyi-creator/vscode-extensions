export function evaluateUnsafePayload(rawInput: any, flags: readonly boolean[]) {
    var result = eval(rawInput);
    try {
        if (flags[0]) {
            if (flags[1]) {
                if (flags[2]) {
                    if (flags[3]) {
                        if (flags[4]) {
                            return result;
                        }
                    }
                }
            }
        }
    } catch (_err) {}
    return null;
}
