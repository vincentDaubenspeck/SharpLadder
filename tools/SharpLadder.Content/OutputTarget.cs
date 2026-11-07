using Microsoft.Win32.SafeHandles;

namespace SharpLadder.Content;

// Where the output goes, checked before anything is created: the deepest folder of the output
// path that exists (Base), and the names below it that this run will create. The output root is
// Base itself when Missing is empty.
internal sealed record OutputTarget(string Display, string BaseCanonical, FileIdentity BaseId, IReadOnlyList<string> Missing, IReadOnlyList<(InputTree Tree, string Role)> Inputs)
{
    public static OutputTarget Prepare(string path, IReadOnlyList<(InputTree Tree, string Role)> inputs)
    {
        if (KernelPath.EntryProblem(path) is { } problem)
        {
            throw new BoundaryException($"{path}: {problem}");
        }

        var missing = new List<string>();
        using var handle = OpenDeepest(path, missing, out var current);
        var info = KernelPath.Inspect(handle, path);
        if (!info.IsFolder)
        {
            throw new BoundaryException(missing.Count == 0
                ? $"{path}: output folder must be empty or absent; a file is there"
                : $"{path}: {current} is not a folder");
        }

        // Mount points are accepted only above the output root, as for the input roots.
        if (missing.Count == 0 && info.IsMountRoot)
        {
            throw new BoundaryException($"{path}: a root folder must not be a mount point; mount points are accepted only above it");
        }

        var canonical = KernelPath.Canonical(handle, current, path);
        if (missing.Count == 0 && Directory.EnumerateFileSystemEntries(canonical).Any())
        {
            throw new BoundaryException($"{path}: output folder must be empty or absent");
        }

        var target = new OutputTarget(path, canonical, info.Id, missing, inputs);
        target.CheckDisjoint();
        return target;
    }

    // No folder from the file system root down to the output root is a folder of an input tree,
    // by kernel identity, which a bind mount or other alias shares with its source; the
    // comparison of canonical paths is a second, independent check.
    public void CheckDisjoint()
    {
        var ancestors = KernelPath.Ancestors(BaseCanonical, Display);
        var output = Path.Join([BaseCanonical, .. Missing]);
        foreach (var (tree, role) in Inputs)
        {
            if (ancestors.Any(tree.FolderIds.Contains) || Overlaps(output, tree.Root.Canonical))
            {
                throw new BoundaryException($"{Display}: the output folder must lie outside the {role}, and must not be it");
            }
        }
    }

    // The deepest folder of path that exists, followed through links as the kernel follows them;
    // missing receives the names below it, outermost first.
    private static SafeFileHandle OpenDeepest(string path, List<string> missing, out string found)
    {
        for (var current = Path.TrimEndingDirectorySeparator(path); ; current = Path.GetDirectoryName(current)!)
        {
            if (KernelPath.TryOpen(current, path) is { } handle)
            {
                found = current;
                return handle;
            }

            // Nothing to follow, yet something has the name: a link that leads nowhere.
            using (var unfollowed = KernelPath.TryOpen(current, path, follow: false))
            {
                if (unfollowed is not null)
                {
                    throw new BoundaryException($"{path}: {current} is a link that leads nowhere");
                }
            }

            if (Path.GetDirectoryName(current) is null)
            {
                throw new BoundaryException($"{path}: no part of the output path exists");
            }

            missing.Insert(0, Path.GetFileName(current));
        }
    }

    private static bool Overlaps(string a, string b)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var (left, right) = (Path.TrimEndingDirectorySeparator(a) + Path.DirectorySeparatorChar, Path.TrimEndingDirectorySeparator(b) + Path.DirectorySeparatorChar);
        return left.StartsWith(right, comparison) || right.StartsWith(left, comparison);
    }
}
