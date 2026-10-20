/* Hermetic compiled stand-in for a native queue process. It is NOT Codex and
 * qualifies nothing: a compiled executable lets /proc/<pid>/exe equal the
 * selected binary, which a script fixture (exe = interpreter) cannot model.
 * All configuration arrives through the environment; message text is only
 * echoed back as this request's own queue receipt. */
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char *env(const char *name, const char *fallback) {
  const char *value = getenv(name);
  return value && *value ? value : fallback;
}
static void record(const char *event) {
  const char *path = getenv("FIXTURE_LOG");
  if (!path) return;
  FILE *log = fopen(path, "a");
  if (log) { fprintf(log, "{\"event\":\"%s\",\"pid\":%ld}\n", event, (long)getpid()); fclose(log); }
}
static long request_id(const char *line) {
  const char *id = strstr(line, "\"id\":");
  return id ? strtol(id + 5, NULL, 10) : -1;
}
/* Copies a JSON string value without unescaping; fixture IDs are plain. */
static int string_field(const char *line, const char *key, char *out, size_t size) {
  char pattern[64];
  snprintf(pattern, sizeof pattern, "\"%s\":\"", key);
  const char *start = strstr(line, pattern), *end;
  if (!start) return 0;
  start += strlen(pattern); end = strchr(start, '"');
  if (!end || (size_t)(end - start) >= size) return 0;
  memcpy(out, start, (size_t)(end - start)); out[end - start] = 0;
  return 1;
}
int main(int argc, char **argv) {
  const char *version = env("FIXTURE_VERSION", "0.162.1");
  if (argc > 1 && !strcmp(argv[1], "--version")) { record("version"); printf("codex-cli %s\n", version); return 0; }
  if (argc < 2 || strcmp(argv[1], "app-server")) return 2;
  record("app-server");
  const char *storage = env("FIXTURE_STORAGE_HOME", env("CODEX_SQLITE_HOME", "."));
  char path[4096];
  snprintf(path, sizeof path, "%s/state_5.sqlite", storage);
  if (open(path, O_RDWR | O_CREAT, 0600) < 0) return 3;
  snprintf(path, sizeof path, "%s/queue_1.sqlite", storage);
  if (open(path, O_RDWR | O_CREAT, 0600) < 0) return 3;
  static char line[262144];
  while (fgets(line, sizeof line, stdin)) {
    long id = request_id(line);
    if (strstr(line, "\"method\":\"initialize\"")) {
      record("initialize");
      printf("{\"id\":%ld,\"result\":{\"codexHome\":\"%s\",\"platformFamily\":\"unix\",\"platformOs\":\"%s\","
        "\"userAgent\":\"session-peer-native-queue/%s (fixture)\"}}\n", id, env("CODEX_HOME", ""),
        env("FIXTURE_OS", "linux"), env("FIXTURE_RUNTIME_VERSION", version));
    } else if (strstr(line, "\"method\":\"thread/queue/add\"")) {
      char client[256]; const char *input = strstr(line, "\"input\":");
      record("queue");
      size_t length = input ? strlen(input) : 0;
      /* input is the final params member: drop the trailing "}}\n". */
      if (!input || !string_field(line, "clientUserMessageId", client, sizeof client) || length < 11) return 4;
      printf("{\"id\":%ld,\"result\":{\"queuedSubmission\":{\"id\":\"fixture-native-q\",\"clientUserMessageId\":\"%s\",%.*s}}}\n",
        id, client, (int)(length - 3), input);
    }
    fflush(stdout);
  }
  return 0;
}
