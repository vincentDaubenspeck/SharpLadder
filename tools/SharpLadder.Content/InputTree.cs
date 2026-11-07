namespace SharpLadder.Content;

// Every entry below an input root at every depth, read once before anything is compiled, so a
// link, mount point, special or hard-linked file anywhere in the tree is refused even where no
// compile step would look. Compiling uses these entries, never a second listing.
internal sealed class InputTree
{
    private readonly Dictionary<string, List<InputEntry>> _children = new(StringComparer.Ordinal);

    private InputTree(Folder root)
    {
        Root = root;
        FolderIds.Add(root.Id);
    }

    public Folder Root { get; }

    // The root and every folder below it; an output folder that shares one of these identities
    // would write into the tree, whatever path reached it.
    public HashSet<FileIdentity> FolderIds { get; } = [];

    public static InputTree Read(Folder root)
    {
        var tree = new InputTree(root);
        tree.Walk(root, string.Empty);
        return tree;
    }

    // The entries directly in the folder at relative ("" for the root), in ordinal name order.
    public IReadOnlyList<InputEntry> Children(string relative) =>
        _children.TryGetValue(relative, out var entries) ? entries : [];

    private void Walk(Folder folder, string relative)
    {
        var entries = new List<InputEntry>();
        _children[relative] = entries;
        foreach (var (name, isFolder) in folder.List())
        {
            var path = relative.Length == 0 ? name : $"{relative}/{name}";
            if (isFolder)
            {
                using var child = folder.OpenFolder(name);
                FolderIds.Add(child.Id);
                entries.Add(new InputEntry(name, path, child.Display, null));
                Walk(child, path);
            }
            else
            {
                entries.Add(new InputEntry(name, path, folder.ChildDisplay(name), folder.ReadFile(name)));
            }
        }
    }
}
