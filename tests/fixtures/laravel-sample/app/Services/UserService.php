<?php

namespace App\Services;

use App\Models\User;
use App\Repositories\UserRepository;
use App\Contracts\UserServiceInterface;

class UserService implements UserServiceInterface
{
    private UserRepository $userRepo;

    public function __construct(UserRepository $userRepo)
    {
        $this->userRepo = $userRepo;
    }

    /**
     * Find a user by their ID.
     */
    public function findById(int $id): ?User
    {
        return $this->userRepo->find($id);
    }

    public function create(array $data): User
    {
        return $this->userRepo->create($data);
    }

    public function update(int $id, array $data): User
    {
        $user = $this->findById($id);
        if (!$user) {
            throw new \RuntimeException("User not found: {$id}");
        }
        return $this->userRepo->update($user, $data);
    }
}
