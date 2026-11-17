package cn.bg7qvu.htisw.ecashier;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.logging.Logger;

final class BridgeClient implements AutoCloseable {
    private final URI uri;
    private final WireCrypto crypto;
    private final Logger log;
    private final BiConsumer<Connection, JsonObject> receiver;
    private final ScheduledExecutorService loop = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "union-cashier-bridge");
        thread.setDaemon(true);
        return thread;
    });
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private volatile Connection current;
    private boolean connecting;

    BridgeClient(URI uri, WireCrypto crypto, Logger log, BiConsumer<Connection, JsonObject> receiver) {
        this.uri = uri;
        this.crypto = crypto;
        this.log = log;
        this.receiver = receiver;
        loop.scheduleWithFixedDelay(this::tick, 0, 5, TimeUnit.SECONDS);
    }

    private void tick() {
        if (current != null && current.nonce != null) {
            JsonObject heartbeat = new JsonObject();
            heartbeat.addProperty("type", "ping");
            current.sendOnLoop(heartbeat);
            return;
        }
        if (current == null && !connecting) {
            connecting = true;
            client.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5)).buildAsync(uri, new Connection())
                .whenComplete((ignored, error) -> submit(() -> connecting = false));
        }
    }

    private void submit(Runnable job) {
        if (!loop.isShutdown()) {
            try {
                loop.execute(job);
            } catch (java.util.concurrent.RejectedExecutionException ignored) {
                // Shutdown won the race.
            }
        }
    }

    @Override
    public void close() {
        loop.shutdownNow();
        Connection connection = current;
        if (connection != null) {
            connection.socket.abort();
        }
    }

    final class Connection implements WebSocket.Listener {
        private final StringBuilder fragments = new StringBuilder();
        private WebSocket socket;
        private volatile String nonce;
        private java.util.concurrent.CompletableFuture<WebSocket> outgoing;

        @Override
        public void onOpen(WebSocket webSocket) {
            socket = webSocket;
            submit(() -> current = this);
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            if ((long) fragments.length() + data.length() > 16384) {
                webSocket.abort();
                submit(() -> disconnect(this));
                return null;
            }
            fragments.append(data);
            if (last) {
                String message = fragments.toString();
                fragments.setLength(0);
                submit(() -> receive(message));
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int status, String reason) {
            submit(() -> disconnect(this));
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            submit(() -> disconnect(this));
        }

        private void receive(String message) {
            if (current != this) {
                return;
            }
            try {
                JsonObject input = JsonParser.parseString(message).getAsJsonObject();
                if (nonce == null) {
                    String challenge = input.get("challenge").getAsString();
                    if (!challenge.matches("[0-9a-f]{32}")) {
                        throw new IllegalArgumentException("Invalid session challenge");
                    }
                    nonce = challenge;
                    JsonObject hello = new JsonObject();
                    hello.addProperty("type", "hello");
                    sendOnLoop(hello);
                    return;
                }
                JsonObject payload = crypto.open(input, "backend-to-plugin");
                if (!nonce.equals(payload.get("nonce").getAsString())) {
                    throw new IllegalArgumentException("Invalid session binding");
                }
                receiver.accept(this, payload);
            } catch (Exception error) {
                log.warning("Bridge rejected a message: " + error.getClass().getSimpleName());
                socket.abort();
                disconnect(this);
            }
        }

        void send(JsonObject message) {
            submit(() -> sendOnLoop(message));
        }

        private void sendOnLoop(JsonObject message) {
            if (current != this || nonce == null) {
                return;
            }
            try {
                message.addProperty("nonce", nonce);
                String sealed = crypto.seal(message, "plugin-to-backend").toString();
                outgoing = outgoing == null ? socket.sendText(sealed, true)
                    : outgoing.thenCompose(previous -> socket.sendText(sealed, true));
                outgoing.exceptionally(error -> {
                    socket.abort();
                    submit(() -> disconnect(this));
                    return null;
                });
            } catch (Exception error) {
                log.warning("Bridge could not send a signed message: " + error.getClass().getSimpleName());
                socket.abort();
                disconnect(this);
            }
        }
    }

    private void disconnect(Connection connection) {
        if (current == connection) {
            current = null;
        }
    }
}
