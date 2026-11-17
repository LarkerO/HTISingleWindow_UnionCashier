package cn.bg7qvu.htisw.ecashier;

import com.google.gson.JsonObject;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

import static java.nio.file.StandardOpenOption.APPEND;
import static java.nio.file.StandardOpenOption.CREATE;
import static java.nio.file.StandardOpenOption.WRITE;

final class Journal {
    private record Entry(String fingerprint, String result) {}

    private final Path path;
    private final Map<String, Entry> entries = new HashMap<>();

    Journal(Path path) throws IOException {
        this.path = path;
        if (Files.exists(path)) {
            try (var lines = Files.lines(path)) {
                for (String line : (Iterable<String>) lines::iterator) {
                    String[] fields = line.split(" ", -1);
                    if (fields.length != 3 || !fields[0].matches("[0-9a-f]{32}")
                        || !fields[1].matches("[0-9a-f]{64}") || !fields[2].matches("[a-z_]+")) {
                        throw new IOException("Invalid wallet journal entry; reconcile before restarting");
                    }
                    entries.put(fields[0], new Entry(fields[1], fields[2]));
                }
            }
        } else {
            Files.createFile(path);
        }
    }

    synchronized String existing(String id, String fingerprint) {
        Entry entry = entries.get(id);
        return entry == null ? null : (entry.fingerprint().equals(fingerprint) ? entry.result() : "uncertain");
    }

    synchronized void record(String id, String fingerprint, String status) throws IOException {
        ByteBuffer buffer = StandardCharsets.UTF_8.encode(id + " " + fingerprint + " " + status + "\n");
        try (FileChannel channel = FileChannel.open(path, CREATE, WRITE, APPEND)) {
            while (buffer.hasRemaining()) {
                channel.write(buffer);
            }
            channel.force(true);
        }
        entries.put(id, new Entry(fingerprint, status));
    }

    static JsonObject result(String id, String status) {
        JsonObject result = new JsonObject();
        result.addProperty("type", "result");
        result.addProperty("id", id);
        result.addProperty("status", status);
        return result;
    }
}
