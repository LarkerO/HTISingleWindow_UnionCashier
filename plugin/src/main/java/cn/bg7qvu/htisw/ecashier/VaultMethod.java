package cn.bg7qvu.htisw.ecashier;

import net.milkbowl.vault.economy.Economy;
import net.milkbowl.vault.economy.EconomyResponse;
import org.bukkit.OfflinePlayer;
import org.bukkit.Server;
import org.bukkit.plugin.RegisteredServiceProvider;

import java.util.UUID;

final class VaultMethod implements PaymentMethod {
    private final Server server;
    private final String providerName;

    VaultMethod(Server server, String providerName) {
        this.server = server;
        this.providerName = providerName;
    }

    private Economy provider() {
        for (RegisteredServiceProvider<Economy> registration : server.getServicesManager().getRegistrations(Economy.class)) {
            Economy provider = registration.getProvider();
            if (provider.isEnabled() && (providerName.isBlank() || providerName.equalsIgnoreCase(provider.getName()))) {
                return provider;
            }
        }
        throw new Unavailable();
    }

    @Override
    public double balance(UUID id) {
        Economy economy = provider();
        OfflinePlayer player = server.getOfflinePlayer(id);
        return economy.getBalance(player);
    }

    @Override
    public String debit(UUID id, int amount) {
        Economy economy = provider();
        OfflinePlayer player = server.getOfflinePlayer(id);
        if (!economy.hasAccount(player)) {
            return "unavailable";
        }
        if (!economy.has(player, amount)) {
            return "insufficient";
        }
        return outcome(economy.withdrawPlayer(player, amount), amount);
    }

    @Override
    public String credit(UUID id, int amount) {
        Economy economy = provider();
        OfflinePlayer player = server.getOfflinePlayer(id);
        if (!economy.hasAccount(player)) {
            return "unavailable";
        }
        return outcome(economy.depositPlayer(player, amount), amount);
    }

    private static String outcome(EconomyResponse response, int amount) {
        if (!response.transactionSuccess()) {
            return response.amount == 0 ? "declined" : "uncertain";
        }
        return response.amount == amount ? "ok" : "uncertain";
    }
}
