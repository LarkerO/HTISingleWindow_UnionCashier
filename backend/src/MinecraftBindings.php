<?php
declare(strict_types=1);

namespace Cashier;

final class MinecraftBindings
{
    public function __construct(private readonly Store $db)
    {
    }

    private function admin(array $actor): void
    {
        if (!($this->db->get('user', $actor['id'])['admin'] ?? false)) {
            throw new Fault('需要超级管理员权限', 403);
        }
    }

    public function inspect(array $actor, string $id): array
    {
        $this->admin($actor);
        $user = $this->db->get('user', $id) ?? throw new Fault('Portal 账号尚未登录本系统', 404);
        $events = $this->db->list('minecraft_binding_event', $id);
        usort($events, static fn ($a, $b) => $b['created'] <=> $a['created']);
        return [
            'user' => array_intersect_key($user, array_flip(['id', 'name', 'hydroline_id', 'uuid',
                'minecraft_name', 'minecraft_status', 'minecraft_source', 'minecraft_uuid_origin'])),
            'portal' => $this->db->get('portal_minecraft', $id),
            'override' => $this->db->get('minecraft_override', $id),
            'events' => array_slice($events, 0, 20),
        ];
    }

    public function change(array $actor, array $input): array
    {
        return $this->db->write(function () use ($actor, $input) {
            $this->admin($actor);
            $id = Clearing::text($input, 'user');
            $user = $this->db->get('user', $id) ?? throw new Fault('Portal 账号尚未登录本系统', 404);
            $action = Clearing::text($input, 'action');
            $reason = trim(Clearing::text($input, 'reason', 500));
            if ($reason === '') throw new Fault('请填写变更原因');
            $portal = $this->db->get('portal_minecraft', $id) ?? array_intersect_key($user,
                array_flip(['uuid', 'minecraft_name', 'minecraft_status', 'minecraft_uuid_origin']));
            if ($action === 'bind') {
                $uuid = Portal::normalizeUuid($input['uuid'] ?? null) ?? throw new Fault('请输入有效的 Minecraft UUID');
                $name = trim(Clearing::text($input, 'minecraft_name', 50));
                if (!preg_match('/\A[A-Za-z0-9_]{1,50}\z/', $name)) throw new Fault('请输入有效的 Minecraft 玩家名称');
            } elseif ($action === 'restore') {
                $uuid = $portal['uuid'] ?? null;
            } else {
                throw new Fault('无效绑定操作');
            }
            if ($uuid !== null && ($this->db->get('uuid', $uuid)['user'] ?? $id) !== $id) {
                throw new Fault('该 Minecraft UUID 已关联其他清算账号', 409, 'MINECRAFT_UUID_IN_USE');
            }
            if ($action === 'bind') {
                $this->db->put('minecraft_override', $id, ['uuid' => $uuid, 'minecraft_name' => $name,
                    'actor' => $actor['id'], 'reason' => $reason, 'created' => time()]);
            } else {
                $this->db->delete('minecraft_override', $id);
            }
            Portal::saveProfile($this->db, ['id' => $id] + $portal);
            $updated = $this->db->get('user', $id);
            $eventId = Config::token();
            $this->db->put('minecraft_binding_event', $eventId, ['id' => $eventId, 'user' => $id,
                'actor' => $actor['id'], 'action' => $action, 'reason' => $reason, 'created' => time(),
                'previous_uuid' => $user['uuid'] ?? null, 'uuid' => $updated['uuid'] ?? null], $id);
            return $this->inspect($actor, $id);
        });
    }
}
