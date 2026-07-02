import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService, Profile } from "@paadi/db";

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string) {
    return this.prisma.profile.findUnique({ where: { userId } });
  }

  findByUsernameNormalized(normalized: string) {
    return this.prisma.profile.findUnique({
      where: { usernameNormalized: normalized },
    });
  }

  async isUsernameTaken(normalized: string): Promise<boolean> {
    const count = await this.prisma.profile.count({
      where: { usernameNormalized: normalized },
    });
    return count > 0;
  }

  updateProfile(
    userId: string,
    data: Prisma.ProfileUpdateInput,
  ): Promise<Profile> {
    return this.prisma.profile.update({ where: { userId }, data });
  }

  renameUsername(
    userId: string,
    username: string,
    usernameNormalized: string,
  ): Promise<Profile> {
    return this.prisma.profile.update({
      where: { userId },
      data: { username, usernameNormalized },
    });
  }
}
