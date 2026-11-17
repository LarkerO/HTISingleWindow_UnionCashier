package cn.bg7qvu.htisw.ecashier;

import java.util.UUID;

interface PaymentMethod {
    double balance(UUID player);

    String debit(UUID player, int amount);

    String credit(UUID player, int amount);

    final class Unavailable extends RuntimeException {
        Unavailable() {
            super("Payment method unavailable");
        }
    }
}
