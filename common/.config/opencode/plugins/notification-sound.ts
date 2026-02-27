import type { Plugin } from "@opencode-ai/plugin";
import { homedir } from "os";
import { join } from "path";

type SoundPlayer = (soundPath: string) => Promise<void>;

export const NotificationSound: Plugin = async ({ $, client }) => {
    if (process.platform !== "darwin" && process.platform !== "linux") {
        return {};
    }

    const completionSoundPath = join(
        homedir(),
        ".config/opencode/sounds/wow_quest_complete.mp3",
    );
    const inputRequiredSoundPath = join(
        homedir(),
        ".config/opencode/sounds/wow_quest_active.mp3",
    );
    const playbackVolume = 0.25;
    const playbackVolumePercent = Math.round(playbackVolume * 100);
    const completionDelayMs = 3000;
    let resolvedSoundPlayer: SoundPlayer | null | undefined;

    const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const interruptedSessions = new Set<string>();
    const awaitingInputSessions = new Set<string>();
    const busySessions = new Set<string>();
    const mainSessionCache = new Map<string, boolean>();

    const clearIdleTimer = (sessionID: string): void => {
        const timer = idleTimers.get(sessionID);
        if (timer) {
            clearTimeout(timer);
            idleTimers.delete(sessionID);
        }
    };

    const commandExists = async (command: string): Promise<boolean> => {
        try {
            await $`command -v ${command}`.quiet();
            return true;
        } catch {
            return false;
        }
    };

    const resolveSoundPlayer = async (): Promise<SoundPlayer | null> => {
        if (resolvedSoundPlayer !== undefined) {
            return resolvedSoundPlayer;
        }

        if (process.platform === "darwin") {
            resolvedSoundPlayer = async (soundPath: string): Promise<void> => {
                await $`afplay -v ${playbackVolume} ${soundPath}`
                    .quiet()
                    .nothrow();
            };
            return resolvedSoundPlayer;
        }

        if (await commandExists("paplay")) {
            resolvedSoundPlayer = async (soundPath: string): Promise<void> => {
                await $`paplay ${soundPath}`
                    .quiet()
                    .nothrow();
            };
            return resolvedSoundPlayer;
        }

        if (await commandExists("mpv")) {
            resolvedSoundPlayer = async (soundPath: string): Promise<void> => {
                await $`mpv --no-terminal --no-video --really-quiet --volume=${playbackVolumePercent} ${soundPath}`
                    .quiet()
                    .nothrow();
            };
            return resolvedSoundPlayer;
        }

        if (await commandExists("ffplay")) {
            const volumeFilter = `volume=${playbackVolume}`;
            resolvedSoundPlayer = async (soundPath: string): Promise<void> => {
                await $`ffplay -nodisp -autoexit -loglevel error -af ${volumeFilter} ${soundPath}`
                    .quiet()
                    .nothrow();
            };
            return resolvedSoundPlayer;
        }

        resolvedSoundPlayer = null;
        return resolvedSoundPlayer;
    };

    const playSound = async (soundPath: string): Promise<void> => {
        const player = await resolveSoundPlayer();
        if (!player) {
            return;
        }
        await player(soundPath);
    };

    const playCompletionNotificationSound = async (): Promise<void> => {
        await playSound(completionSoundPath);
    };

    const playInputRequiredNotificationSound = async (): Promise<void> => {
        await playSound(inputRequiredSoundPath);
    };

    const isMainSession = async (sessionID: string): Promise<boolean> => {
        const cached = mainSessionCache.get(sessionID);
        if (cached !== undefined) {
            return cached;
        }

        try {
            const result = await client.session.get({ path: { id: sessionID } });
            const session = (result as any).data ?? result;
            const isMain = !session.parentID;
            mainSessionCache.set(sessionID, isMain);
            return isMain;
        } catch {
            return true;
        }
    };

    const markSessionInterrupted = (sessionID: string): void => {
        interruptedSessions.add(sessionID);
        busySessions.delete(sessionID);
        clearIdleTimer(sessionID);
    };

    const sessionIDFromProperties = (
        properties: Record<string, unknown>,
    ): string | undefined => {
        const sessionID = properties.sessionID;
        if (typeof sessionID !== "string" || sessionID.length === 0) {
            return undefined;
        }
        return sessionID;
    };

    const handleSessionBusy = (sessionID: string): void => {
        clearIdleTimer(sessionID);
        busySessions.add(sessionID);
        awaitingInputSessions.delete(sessionID);
        interruptedSessions.delete(sessionID);
    };

    const handleSessionIdle = async (sessionID: string): Promise<void> => {
        clearIdleTimer(sessionID);
        busySessions.delete(sessionID);

        if (!(await isMainSession(sessionID))) {
            return;
        }

        idleTimers.set(
            sessionID,
            setTimeout(async () => {
                idleTimers.delete(sessionID);

                if (interruptedSessions.delete(sessionID)) {
                    return;
                }

                if (awaitingInputSessions.has(sessionID)) {
                    return;
                }

                await playCompletionNotificationSound();
            }, completionDelayMs),
        );
    };

    const handleQuestionAsked = async (sessionID: string): Promise<void> => {
        clearIdleTimer(sessionID);
        awaitingInputSessions.add(sessionID);

        if (!(await isMainSession(sessionID))) {
            return;
        }

        await playInputRequiredNotificationSound();
    };

    process.on("exit", () => {
        for (const timer of idleTimers.values()) {
            clearTimeout(timer);
        }
        idleTimers.clear();
        interruptedSessions.clear();
        awaitingInputSessions.clear();
        busySessions.clear();
        mainSessionCache.clear();
    });

    return {
        event: async ({ event }) => {
            const eventType = (event as { type: string }).type;
            const properties = (event as any).properties ?? {};
            const sessionID = sessionIDFromProperties(properties);

            if (eventType === "session.deleted") {
                const deletedSessionID = properties.info?.id;
                if (typeof deletedSessionID === "string") {
                    clearIdleTimer(deletedSessionID);
                    interruptedSessions.delete(deletedSessionID);
                    awaitingInputSessions.delete(deletedSessionID);
                    busySessions.delete(deletedSessionID);
                    mainSessionCache.delete(deletedSessionID);
                }
                return;
            }

            if (eventType === "tui.command.execute") {
                const command = properties.command;
                if (command === "session.interrupt") {
                    for (const busySessionID of busySessions) {
                        markSessionInterrupted(busySessionID);
                    }
                }
                return;
            }

            if (eventType === "message.updated") {
                const info = properties.info;
                const errorName = info?.error?.name;
                if (
                    info?.role === "assistant"
                    && typeof info.sessionID === "string"
                    && errorName === "MessageAbortedError"
                ) {
                    markSessionInterrupted(info.sessionID);
                }
                return;
            }

            if (eventType === "session.error") {
                const errorName = properties.error?.name;
                if (sessionID && errorName === "MessageAbortedError") {
                    markSessionInterrupted(sessionID);
                }
                return;
            }

            if (eventType === "question.asked") {
                if (!sessionID) return;
                await handleQuestionAsked(sessionID);
                return;
            }

            if (
                eventType === "question.replied"
                || eventType === "question.rejected"
            ) {
                if (!sessionID) return;
                awaitingInputSessions.delete(sessionID);
                return;
            }

            if (eventType === "session.status") {
                const statusType = properties.status?.type;
                if (!sessionID || typeof statusType !== "string") return;

                if (statusType === "busy") {
                    handleSessionBusy(sessionID);
                    return;
                }

                if (statusType === "idle") {
                    await handleSessionIdle(sessionID);
                    return;
                }

                return;
            }

            if (eventType === "session.busy") {
                if (!sessionID) return;
                handleSessionBusy(sessionID);
                return;
            }

            if (eventType === "session.idle") {
                if (!sessionID) return;
                await handleSessionIdle(sessionID);
                return;
            }
        },
    };
};
