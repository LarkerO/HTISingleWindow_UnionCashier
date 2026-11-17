package cn.bg7qvu.htisw.ecashier;

import org.bukkit.Server;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Score;
import org.bukkit.scoreboard.Scoreboard;

import java.util.UUID;

final class ScoreboardMethod implements PaymentMethod {
    private final Server server;
    private final String objective;

    ScoreboardMethod(Server server, String objective, boolean create) {
        this.server = server;
        this.objective = objective;
        Scoreboard board = server.getScoreboardManager().getMainScoreboard();
        if (create && board.getObjective(objective) == null) {
            board.registerNewObjective(objective, "dummy", objective);
        }
    }

    private Score score(UUID id) {
        Objective value = server.getScoreboardManager().getMainScoreboard().getObjective(objective);
        String name = server.getOfflinePlayer(id).getName();
        if (value == null || !value.isModifiable() || name == null) {
            throw new Unavailable();
        }
        return value.getScore(name);
    }

    @Override
    public double balance(UUID id) {
        return score(id).getScore();
    }

    @Override
    public String debit(UUID id, int amount) {
        Score score = score(id);
        int current = score.getScore();
        if (current < amount) {
            return "insufficient";
        }
        score.setScore(current - amount);
        return "ok";
    }

    @Override
    public String credit(UUID id, int amount) {
        Score score = score(id);
        long update = (long) score.getScore() + amount;
        if (update > Integer.MAX_VALUE) {
            return "range";
        }
        score.setScore((int) update);
        return "ok";
    }
}
