import { useQuery } from "@tanstack/react-query";
import { listSkills } from "@/ipc/skills";

/**
 * Skills are added in Finder, so this reads the folder on every mount. Reading
 * also creates the folder, so it's there to put skills in.
 */
export function useSkills(folderPath: string) {
  return useQuery({
    queryKey: ["skills", folderPath],
    queryFn: () => listSkills(folderPath),
    enabled: !!folderPath,
    staleTime: 0,
  });
}
