using System.Security.Cryptography;
using System.Text;

namespace SharpLadder.Content;

// The digest of an output set: SHA-256 over sha256sum-style lines ("<hex>  <path>\n"), one per
// file in ordinal path order. tools/checks/content.mjs computes the same value independently.
internal static class OutputDigest
{
    public static string Compute(IEnumerable<OutputFile> files)
    {
        var manifest = new StringBuilder();
        foreach (var file in files.OrderBy(f => f.RelativePath, StringComparer.Ordinal))
        {
            manifest.Append(Convert.ToHexStringLower(SHA256.HashData(file.Bytes))).Append("  ").Append(file.RelativePath).Append('\n');
        }

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(manifest.ToString())));
    }
}
