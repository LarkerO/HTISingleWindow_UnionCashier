<?php
declare(strict_types=1);

namespace Cashier;

final class Fault extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 400,
        private readonly ?string $businessCode = null,
    )
    {
        parent::__construct($message);
    }

    public function errorCode(): string
    {
        return $this->businessCode ?? match ($this->status) {
            400 => 'INVALID_PARAMETER',
            401 => 'AUTHENTICATION_FAILED',
            403 => 'FORBIDDEN',
            404 => 'NOT_FOUND',
            405 => 'METHOD_NOT_ALLOWED',
            409 => 'CONFLICT',
            415 => 'UNSUPPORTED_BODY',
            502 => 'UPSTREAM_ERROR',
            503 => 'UNAVAILABLE',
            default => 'INTERNAL_ERROR',
        };
    }
}
