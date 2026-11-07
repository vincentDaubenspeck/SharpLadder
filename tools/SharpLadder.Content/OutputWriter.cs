namespace SharpLadder.Content;

// The output appears whole or not at all. Files go straight into the output root, which was empty
// or absent, and a failed run removes exactly the entries it created, each only while it keeps
// the identity recorded when it was created; the output root is then empty or absent again.
internal static class OutputWriter
{
    public static string? Write(OutputTarget target, IReadOnlyList<OutputFile> files)
    {
        var created = new List<Entry>();
        try
        {
            target.CheckDisjoint();
            using var open = new Owned();
            var places = new Dictionary<string, Place>(StringComparer.Ordinal);
            var root = new Place(open.Keep(Folder.Reopen(target.BaseCanonical, target.BaseId, target.BaseCanonical)), [], []);
            foreach (var name in target.Missing)
            {
                root = Create(open, created, root, name);
            }

            places[string.Empty] = root;
            foreach (var file in files.OrderBy(f => f.RelativePath, StringComparer.Ordinal))
            {
                var parts = file.RelativePath.Split('/');
                var place = Locate(open, created, places, parts[..^1]);
                using var chain = Chain.Open(target, place);
                using var handle = chain.Last.CreateFile(parts[^1], out var id);
                created.Add(new Entry(place, parts[^1], id, IsFolder: false));
                RandomAccess.Write(handle, file.Bytes, 0);
            }

            return null;
        }
        catch (Exception e) when (e is BoundaryException or IOException or UnauthorizedAccessException)
        {
            return e.Message + CleanUp(target, created);
        }
    }

    private static Place Locate(Owned open, List<Entry> created, Dictionary<string, Place> places, string[] folders)
    {
        var key = string.Join('/', folders);
        if (!places.TryGetValue(key, out var place))
        {
            place = Create(open, created, Locate(open, created, places, folders[..^1]), folders[^1]);
            places[key] = place;
        }

        return place;
    }

    private static Place Create(Owned open, List<Entry> created, Place parent, string name)
    {
        var folder = open.Keep(parent.Folder.CreateFolder(name));
        created.Add(new Entry(parent, name, folder.Id, IsFolder: true));
        return new Place(folder, [.. parent.Names, name], [.. parent.Ids, folder.Id]);
    }

    // Newest first, so a folder is empty by the time it is removed. Every handle this run held is
    // closed by now, as Windows keeps a folder until the last handle to it is closed.
    private static string CleanUp(OutputTarget target, List<Entry> created)
    {
        var problems = new List<string>();
        for (var i = created.Count - 1; i >= 0; i--)
        {
            var entry = created[i];
            try
            {
                using var chain = Chain.Open(target, entry.Parent);
                chain.Last.Remove(entry.Name, entry.Id, entry.IsFolder);
            }
            catch (Exception e) when (e is BoundaryException or IOException or UnauthorizedAccessException)
            {
                problems.Add(e.Message);
            }
        }

        return problems.Count == 0 ? string.Empty : "; cleaning up also failed: " + string.Join("; ", problems);
    }

    // A folder this run holds open, with the names and identities of the created folders that
    // lead to it from the deepest folder that existed before the run.
    private sealed record Place(Folder Folder, IReadOnlyList<string> Names, IReadOnlyList<FileIdentity> Ids);

    private sealed record Entry(Place Parent, string Name, FileIdentity Id, bool IsFolder);

    private sealed class Owned : IDisposable
    {
        private readonly List<Folder> _folders = [];

        public Folder Keep(Folder folder)
        {
            _folders.Add(folder);
            return folder;
        }

        public void Dispose()
        {
            foreach (var folder in _folders)
            {
                folder.Dispose();
            }
        }
    }

    // The folders of a place reopened from the recorded output path, each by name without
    // following links and each checked against the identity recorded when it was created; used
    // immediately before each write and before each removal.
    private sealed class Chain : IDisposable
    {
        private readonly List<Folder> _folders;

        private Chain(List<Folder> folders) => _folders = folders;

        public Folder Last => _folders[^1];

        public static Chain Open(OutputTarget target, Place place)
        {
            var folders = new List<Folder>();
            try
            {
                folders.Add(Folder.Reopen(target.BaseCanonical, target.BaseId, target.BaseCanonical));
                for (var i = 0; i < place.Names.Count; i++)
                {
                    folders.Add(folders[^1].OpenFolder(place.Names[i]));
                    if (folders[^1].Id != place.Ids[i])
                    {
                        throw new BoundaryException($"{folders[^1].Display}: no longer the folder this run created");
                    }
                }

                return new Chain(folders);
            }
            catch
            {
                foreach (var folder in folders)
                {
                    folder.Dispose();
                }

                throw;
            }
        }

        public void Dispose()
        {
            foreach (var folder in _folders)
            {
                folder.Dispose();
            }
        }
    }
}
