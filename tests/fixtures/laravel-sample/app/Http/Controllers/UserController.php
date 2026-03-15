<?php

namespace App\Http\Controllers;

use App\Services\UserService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class UserController extends Controller
{
    public function __construct(
        private readonly UserService $userService
    ) {}

    public function show(int $id): JsonResponse
    {
        $user = $this->userService->findById($id);
        return response()->json($user);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $this->userService->create($request->validated());
        return response()->json($user, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $this->userService->update($id, $request->validated());
        return response()->json($user);
    }
}
