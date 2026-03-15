<?php

namespace App\Contracts;

use App\Models\User;

/**
 * Contract for user service operations.
 */
interface UserServiceInterface
{
    public function findById(int $id): ?User;

    public function create(array $data): User;

    public function update(int $id, array $data): User;
}
