using System.Security.Cryptography;
using System.Text;

namespace SharpLadder.CodeCheck;

// A fresh token per run keeps one run's records from being taken for another's; it is no defence
// against content that reads its own environment.
internal static class RunToken
{
    public static string Create() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(WireContract.TokenBytes));

    public static byte[] ReleaseLine(string token) => Encoding.ASCII.GetBytes(token + "\n");
}
