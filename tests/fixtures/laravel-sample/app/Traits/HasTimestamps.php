<?php

namespace App\Traits;

trait HasTimestamps
{
    protected ?string $createdAtColumn = 'created_at';
    protected ?string $updatedAtColumn = 'updated_at';

    public function getCreatedAt(): ?string
    {
        return $this->{$this->createdAtColumn};
    }

    public function getUpdatedAt(): ?string
    {
        return $this->{$this->updatedAtColumn};
    }

    public function touchTimestamps(): void
    {
        $this->{$this->updatedAtColumn} = date('Y-m-d H:i:s');
    }
}
