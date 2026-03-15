<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Contracts\Auth\Authenticatable;
use App\Traits\HasTimestamps;

/**
 * User model representing an application user.
 */
class User extends Model implements Authenticatable
{
    use HasTimestamps;

    const STATUS_ACTIVE = 'active';
    const STATUS_INACTIVE = 'inactive';

    protected string $table = 'users';

    protected array $fillable = [
        'name',
        'email',
        'password',
    ];

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }
}
