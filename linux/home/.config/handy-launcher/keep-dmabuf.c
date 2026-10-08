#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <string.h>

static int (*next_setenv)(const char *, const char *, int);
static pthread_once_t resolve_once = PTHREAD_ONCE_INIT;

static void resolve_setenv(void) {
    *(void **)(&next_setenv) = dlsym(RTLD_NEXT, "setenv");
}

/* Preserve the launcher's explicit DMA-BUF choice. Pass all other writes on. */
int setenv(const char *name, const char *value, int overwrite) {
    if (strcmp(name, "WEBKIT_DISABLE_DMABUF_RENDERER") == 0) {
        return 0;
    }
    pthread_once(&resolve_once, resolve_setenv);
    if (!next_setenv) {
        errno = ENOSYS;
        return -1;
    }
    return next_setenv(name, value, overwrite);
}
