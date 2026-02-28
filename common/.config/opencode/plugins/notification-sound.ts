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
    const pendingInputRequests = new Map<string, Set<string>>();
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
        const result = await $`which ${command}`.quiet().nothrow();
        return result.exitCode === 0;
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
        pendingInputRequests.delete(sessionID);
        clearIdleTimer(sessionID);
    };

    const hasPendingInputRequests = (sessionID: string): boolean => {
        const requests = pendingInputRequests.get(sessionID);
        return Boolean(requests && requests.size > 0);
    };

    const clearPendingInputRequests = (sessionID: string): void => {
        pendingInputRequests.delete(sessionID);
    };

    const markInputRequested = async (
        sessionID: string,
        requestID: string,
    ): Promise<void> => {
        clearIdleTimer(sessionID);

        const existing = pendingInputRequests.get(sessionID);
        const requests = existing ?? new Set<string>();
        const wasWaiting = requests.size > 0;
        requests.add(requestID);
        pendingInputRequests.set(sessionID, requests);

        if (wasWaiting) {
            return;
        }

        if (!(await isMainSession(sessionID))) {
            return;
        }

        await playInputRequiredNotificationSound();
    };

    const markInputResolved = (
        sessionID: string,
        requestID?: string,
    ): void => {
        const requests = pendingInputRequests.get(sessionID);
        if (!requests) {
            return;
        }

        if (requestID) {
            requests.delete(requestID);
        } else {
            requests.clear();
        }

        if (requests.size === 0) {
            pendingInputRequests.delete(sessionID);
        }
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
        clearPendingInputRequests(sessionID);
        interruptedSessions.delete(sessionID);
    };

    const handleSessionIdle = async (sessionID: string): Promise<void> => {
        clearIdleTimer(sessionID);
        busySessions.delete(sessionID);

        if (!(await isMainSession(sessionID))) {
            return;
        }

        clearIdleTimer(sessionID);

        if (hasPendingInputRequests(sessionID)) {
            return;
        }

        idleTimers.set(
            sessionID,
            setTimeout(async () => {
                idleTimers.delete(sessionID);

                if (interruptedSessions.delete(sessionID)) {
                    return;
                }

                if (hasPendingInputRequests(sessionID)) {
                    return;
                }

                await playCompletionNotificationSound();
            }, completionDelayMs),
        );
    };

    process.on("exit", () => {
        for (const timer of idleTimers.values()) {
            clearTimeout(timer);
        }
        idleTimers.clear();
        interruptedSessions.clear();
        pendingInputRequests.clear();
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
                    clearPendingInputRequests(deletedSessionID);
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
                const requestID = typeof properties.id === "string"
                    ? properties.id
                    : `question:${sessionID}`;
                await markInputRequested(sessionID, requestID);
                return;
            }

            if (
                eventType === "question.replied"
                || eventType === "question.rejected"
            ) {
                if (!sessionID) return;
                const requestID = typeof properties.requestID === "string"
                    ? properties.requestID
                    : undefined;
                markInputResolved(sessionID, requestID);
                return;
            }

            if (eventType === "permission.asked") {
                if (!sessionID) return;
                const requestID = typeof properties.id === "string"
                    ? properties.id
                    : `permission:${sessionID}`;
                await markInputRequested(sessionID, requestID);
                return;
            }

            if (eventType === "permission.replied") {
                if (!sessionID) return;
                const requestID = typeof properties.requestID === "string"
                    ? properties.requestID
                    : undefined;
                markInputResolved(sessionID, requestID);
                return;
            }

            if (eventType === "session.status") {
                const statusType = properties.status?.type;
                if (!sessionID || typeof statusType !== "string") return;

                if (statusType === "busy" || statusType === "retry") {
                    handleSessionBusy(sessionID);
                    return;
                }

                if (statusType === "idle") {
                    await handleSessionIdle(sessionID);
                    return;
                }

                return;
            }
        },
    };
};
