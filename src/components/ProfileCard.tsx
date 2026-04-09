interface ProfileData {
  username: string;
  full_name: string;
  followers: number;
  following: number;
  profile_pic: string;
  posts: string[];
}

export function ProfileCard({ profile }: { profile: ProfileData }) {
  return (
    <div className="gradient-card border border-border rounded-lg p-5">
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-full gradient-instagram p-[2px]">
            <img
              src={profile.profile_pic}
              alt={profile.full_name}
              className="w-full h-full rounded-full object-cover border-2 border-background"
            />
          </div>
        </div>
        <div className="flex-1">
          <h2 className="font-bold text-foreground">{profile.full_name}</h2>
          <p className="text-muted-foreground text-sm">@{profile.username}</p>
        </div>
      </div>
      <div className="flex justify-around mt-4 pt-4 border-t border-border">
        <div className="text-center">
          <p className="font-bold text-foreground">{profile.followers.toLocaleString("pt-BR")}</p>
          <p className="text-xs text-muted-foreground">seguidores</p>
        </div>
        <div className="text-center">
          <p className="font-bold text-foreground">{profile.following.toLocaleString("pt-BR")}</p>
          <p className="text-xs text-muted-foreground">seguindo</p>
        </div>
        <div className="text-center">
          <p className="font-bold text-foreground">{profile.posts.length}</p>
          <p className="text-xs text-muted-foreground">posts</p>
        </div>
      </div>
      {/* Recent posts */}
      <div className="grid grid-cols-3 gap-1 mt-4">
        {profile.posts.slice(0, 3).map((post, i) => (
          <img
            key={i}
            src={post}
            alt={`Post ${i + 1}`}
            className="aspect-square object-cover rounded-sm"
          />
        ))}
      </div>
    </div>
  );
}
