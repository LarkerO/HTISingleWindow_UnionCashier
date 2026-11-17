package cn.bg7qvu.htisw.ecashier;

import com.google.gson.JsonObject;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

public final class CashierPlugin extends JavaPlugin {
    private final Map<String, PaymentMethod> methods = new HashMap<>();
    private Journal journal;
    private BridgeClient bridge;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        try {
            Path data = getDataFolder().toPath();
            Path privateKey = data.resolve(getConfig().getString("private-key", "plugin-private.pem"));
            Path backendKey = data.resolve(getConfig().getString("backend-public-key", "backend-public.pem"));
            URI endpoint = URI.create(getConfig().getString("websocket", "ws://127.0.0.1:8788"));
            if (!"ws".equals(endpoint.getScheme()) && !"wss".equals(endpoint.getScheme())) {
                throw new IllegalArgumentException("websocket must use ws:// or wss://");
            }
            WireCrypto crypto = new WireCrypto(privateKey, backendKey);
            journal = new Journal(data.resolve("economy-journal.log"));
            if (getConfig().getBoolean("vault.enabled") && getServer().getPluginManager().isPluginEnabled("Vault")) {
                methods.put("vault", new VaultMethod(getServer(), getConfig().getString("vault.provider", "")));
            }
            if (getConfig().getBoolean("scoreboard.enabled")) {
                methods.put("scoreboard", new ScoreboardMethod(getServer(),
                    getConfig().getString("scoreboard.objective", "city_balance"),
                    getConfig().getBoolean("scoreboard.create-objective")));
            }
            getLogger().info("Payment methods: " + methods.keySet());
            bridge = new BridgeClient(endpoint, crypto, getLogger(), this::received);
        } catch (Exception | LinkageError error) {
            getLogger().severe("Startup failed: " + error.getMessage());
            getServer().getPluginManager().disablePlugin(this);
        }
    }

    @Override
    public void onDisable() {
        if (bridge != null) {
            bridge.close();
        }
        methods.clear();
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player) || args.length != 2 || !"link".equals(args[0])
            || !args[1].matches("[0-9a-f]{18}")) {
            return false;
        }
        JsonObject request = new JsonObject();
        request.addProperty("type", "link");
        request.addProperty("code", args[1]);
        request.addProperty("uuid", player.getUniqueId().toString());
        request.addProperty("name", player.getName());
        player.sendMessage(bridge != null && bridge.link(request) ? "绑定请求已提交。" : "清算后台未连接，请稍后重试。");
        return true;
    }

    private void received(BridgeClient.Connection connection, JsonObject data) {
        if (!isEnabled()) {
            return;
        }
        getServer().getScheduler().runTask(this, () -> {
            try {
                switch (data.get("type").getAsString()) {
                    case "job" -> run(connection, data);
                    case "link_result" -> {
                        Player player = getServer().getPlayer(UUID.fromString(data.get("uuid").getAsString()));
                        if (player != null) {
                            player.sendMessage(data.get("ok").getAsBoolean() ? "Minecraft 玩家绑定成功。" : "绑定码无效、已使用或玩家已绑定。");
                        }
                    }
                    default -> getLogger().warning("Unknown signed message type");
                }
            } catch (RuntimeException error) {
                getLogger().warning("Invalid signed message: " + error.getClass().getSimpleName());
            }
        });
    }

    private void run(BridgeClient.Connection connection, JsonObject data) {
        String id = data.get("id").getAsString();
        String action = data.get("action").getAsString();
        String rail = data.get("rail").getAsString();
        UUID uuid = UUID.fromString(data.get("uuid").getAsString());
        int amount = data.get("amount").getAsBigDecimal().intValueExact();
        long deadline = data.get("expires").getAsLong();
        if (!id.matches("[0-9a-f]{32}") || deadline < Instant.now().getEpochSecond()) {
            return;
        }
        PaymentMethod method = methods.get(rail);
        if ("balance".equals(action)) {
            connection.send(readBalance(method, uuid, id));
            return;
        }
        if (!("debit".equals(action) || "credit".equals(action)) || amount < 1 || amount > 2_000_000_000) {
            connection.send(Journal.result(id, "range"));
            return;
        }
        String fingerprint = WireCrypto.fingerprint(action + ':' + rail + ':' + uuid + ':' + amount);
        String result = journal.existing(id, fingerprint);
        if (result == null) {
            result = apply(method, uuid, action, amount, id, fingerprint);
        }
        connection.send(Journal.result(id, result));
    }

    private JsonObject readBalance(PaymentMethod method, UUID uuid, String id) {
        if (method != null) {
            try {
                double balance = method.balance(uuid);
                if (Double.isFinite(balance)) {
                    JsonObject result = Journal.result(id, "ok");
                    result.addProperty("balance", balance);
                    return result;
                }
            } catch (RuntimeException error) {
                getLogger().fine("Balance unavailable: " + error.getClass().getSimpleName());
            }
        }
        return Journal.result(id, "unavailable");
    }

    private String apply(PaymentMethod method, UUID uuid, String action, int amount, String id, String fingerprint) {
        try {
            journal.record(id, fingerprint, "uncertain");
            String result;
            try {
                result = method == null ? "unavailable"
                    : ("debit".equals(action) ? method.debit(uuid, amount) : method.credit(uuid, amount));
            } catch (PaymentMethod.Unavailable error) {
                result = "unavailable";
            } catch (RuntimeException | LinkageError error) {
                getLogger().warning("Economy outcome uncertain for " + id + ": " + error.getClass().getSimpleName());
                return "uncertain";
            }
            journal.record(id, fingerprint, result);
            return result;
        } catch (IOException error) {
            getLogger().severe("Economy journal failed for " + id + ": " + error.getMessage());
            return "uncertain";
        }
    }
}
